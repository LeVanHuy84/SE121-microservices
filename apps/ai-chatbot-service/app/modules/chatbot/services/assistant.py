from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from app.core.settings import settings
from app.modules.chatbot.actions.registry import get_action_definition, is_action_allowed
from app.modules.chatbot.navigation.policy import NavOutcome, build_nav_outcome
from app.modules.chatbot.navigation.resolver import NavResolver, nav_resolver
from app.modules.chatbot.navigation.telemetry import intent_telemetry
from app.modules.chatbot.repositories.chat_history import PersistHistoryCommand
from app.modules.chatbot.schemas import (
    AssistantHistoryItem,
    AssistantRespondData,
    AssistantRespondRequest,
    AssistantSource,
    CardPayload,
    CrisisInfo,
    CrisisResource,
    NavigateAction,
    ProposeAction,
    ProposeActionPayload,
    ShowCardAction,
)
from app.modules.chatbot.services.context_resolver import (
    AssistantContextResolver,
    assistant_context_resolver,
)
from app.modules.chatbot.services.emotion_context import (
    EmotionSnapshot,
    emotion_context_service,
)
from app.modules.chatbot.services.guardrails import (
    AssistantScopeGuard,
    CommunityGuard,
    ScopeDecision,
    assistant_community_guard,
    assistant_crisis_guard,
    assistant_scope_guard,
)
from app.modules.chatbot.services.memory import SessionMemory, session_memory
from app.modules.chatbot.services.prompt_builder import CRISIS_RESOURCES, PromptBuilder
from app.modules.chatbot.services.prompt_limits import resolve_prompt_limits
from app.modules.chatbot.tools import (
    ToolDispatcher,
    ToolExecutionContext,
    ToolRouter,
    tool_dispatcher,
    tool_router,
)
from app.providers.base import LlmGeneration, LlmProvider
from app.providers.groq_provider import GroqProvider

logger = logging.getLogger("uvicorn.error")
_LLM_SEMAPHORE = asyncio.Semaphore(max(settings.CHATBOT_MAX_CONCURRENT_LLM, 1))

# Max time to wait for the Kafka crisis alert before replying (so chat never hangs).
_CRISIS_ALERT_TIMEOUT_SECONDS = 2.0
# General-knowledge domains: still call the LLM when there is no RAG context (no diagnosis/prescription).
# App-feature domains without context -> `no_answer` so the LLM does not invent features.
_GENERAL_KNOWLEDGE_DOMAINS = frozenset({"mental_health", "emotion"})
# Kafka alert wire format. The emotion-intelligence-service consumer expects `crisis` (explicit
# self-harm/suicide intent -> CRISIS) and `high` (softer signals -> HIGH_RISK); it treats any other
# value as CRISIS. The FE-facing `crisis.severity` stays `high`/`medium`.
_ALERT_RISK_LEVEL = {"high": "crisis", "medium": "high"}
# Fixed, neutral descriptions (no user text). The consumer feeds `reason` to an LLM when selecting
# support resources, so it must read like a short description rather than a bare rule code.
_ALERT_REASON = {
    "explicit_crisis": "Người dùng thể hiện ý định tự hại hoặc tự sát khi trò chuyện với chatbot.",
    "soft_crisis": "Người dùng có dấu hiệu tuyệt vọng hoặc cô đơn kéo dài khi trò chuyện với chatbot.",
}
_ALERT_REASON_DEFAULT = "Chatbot phát hiện dấu hiệu khủng hoảng tâm lý ở người dùng."



@dataclass(slots=True)
class GuardResult:
    """Outcome of the guard chain: either a final `data` reply, or the context to generate one."""

    data: AssistantRespondData | None = None
    intent: str | None = None
    scope_decision: ScopeDecision | None = None
    contexts: list = field(default_factory=list)
    pending_actions: list[NavigateAction] = field(default_factory=list)


class RespondCommand:
    def __init__(
        self,
        prompt_builder: PromptBuilder | None = None,
        provider: LlmProvider | None = None,
        context_resolver: AssistantContextResolver | None = None,
        scope_guard: AssistantScopeGuard | None = None,
        community_guard: CommunityGuard | None = None,
        memory: SessionMemory | None = None,
        persist_history: PersistHistoryCommand | None = None,
        kafka_producer=None,
        outbox_repo=None,
        nav_resolver_instance: NavResolver | None = None,
        tool_router_instance: ToolRouter | None = None,
        tool_dispatcher_instance: ToolDispatcher | None = None,
    ):
        self.prompt_builder = prompt_builder or PromptBuilder()
        self.provider = provider or GroqProvider()
        self.context_resolver = context_resolver or assistant_context_resolver
        self.scope_guard = scope_guard or assistant_scope_guard
        self.community_guard = community_guard or assistant_community_guard
        self.crisis_guard = assistant_crisis_guard
        self.emotion_ctx = emotion_context_service
        self.memory = memory or session_memory
        self.persist_history = persist_history or PersistHistoryCommand()
        self.nav_resolver = nav_resolver_instance or nav_resolver
        self.tool_router = tool_router_instance or tool_router
        self.dispatcher = tool_dispatcher_instance or tool_dispatcher
        self._kafka_producer = kafka_producer
        self._outbox_repo = outbox_repo

    async def _run_guard_chain(
        self,
        working_request: AssistantRespondRequest,
        history: list[AssistantHistoryItem],
        last_intent: str | None,
        has_follow_up_anchor: bool,
        emotion_snapshot: EmotionSnapshot,
    ) -> GuardResult:
        # --- Mental health crisis check (highest priority guard) ---
        crisis_decision = self.crisis_guard.evaluate(working_request.message)
        if crisis_decision.is_crisis:
            # Bounded wait so we know whether we may say support info was sent to the user's notifications.
            notification_sent = await self._emit_crisis_event(
                working_request,
                crisis_decision.severity,
                crisis_decision.reason,
            )
            reply = self.prompt_builder.build_crisis(
                severity=crisis_decision.severity,
                notification_sent=notification_sent,
            )
            data = self._build_crisis_response(
                reply,
                crisis_decision.severity,
                notification_sent,
            )
            return GuardResult(data=data, intent="mental_health_crisis")

        # --- Community Guard ---
        community_decision = self.community_guard.evaluate(working_request.message)
        if not community_decision.allowed:
            data = self._community_response(community_decision.reason)
            return GuardResult(data=data, intent="community_guard")

        # --- Navigation Resolver ---
        nav = build_nav_outcome(self.nav_resolver.resolve(working_request.message))
        if nav.response is not None:
            self._track_nav_offer(working_request, nav)
            return GuardResult(data=nav.response, intent=nav.intent)

        # --- Context Resolver ---
        candidate_contexts = (
            self._dedupe_contexts(working_request.contexts)
            if working_request.contexts
            else await self._resolve_contexts_with_budget(
                working_request,
                settings.CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS,
                emotion_snapshot,
            )
        )
        working_request = working_request.model_copy(update={"contexts": candidate_contexts})

        # --- Scope Guard ---
        scope_decision = self.scope_guard.evaluate_scope(
            working_request,
            last_intent=last_intent,
            recent_history=history,
        )

        if scope_decision.reason == "greeting":
            return GuardResult(
                data=self._greeting_response(),
                intent="greeting",
                scope_decision=scope_decision,
                contexts=candidate_contexts,
            )

        general_knowledge = self._is_general_knowledge_only(scope_decision)

        if not scope_decision.in_scope:
            intent = "out_of_scope"
            if "privacy" in scope_decision.matched_domains:
                data = self._privacy_policy_response()
                intent = "privacy"
            elif scope_decision.state == "in_domain_unknown":
                if general_knowledge:
                    # Mental health / emotion knowledge: still let the LLM answer.
                    return self._continue_to_llm(working_request, nav, scope_decision, candidate_contexts)
                data = self._in_domain_unknown_response(scope_decision.matched_domains)
                intent = "in_domain_unknown"
            elif scope_decision.state == "ambiguous":
                data = self._ambiguous_scope_response(scope_decision.matched_domains)
                intent = "clarify"
            else:
                data = self._out_of_scope_response()
            return GuardResult(
                data=data,
                intent=intent,
                scope_decision=scope_decision,
                contexts=candidate_contexts,
            )

        prompt_limits = resolve_prompt_limits(working_request.userId)
        final_contexts = candidate_contexts[: prompt_limits.max_context_items]
        has_tools = bool(self.tool_router.get_openai_tools(working_request.surface))

        if (
            not final_contexts
            and not has_tools
            and scope_decision.matched_domains
            and not has_follow_up_anchor
            and not general_knowledge
        ):
            data = self._in_domain_unknown_response(scope_decision.matched_domains)
            return GuardResult(
                data=data,
                intent="in_domain_unknown",
                scope_decision=scope_decision,
                contexts=candidate_contexts,
            )

        return self._continue_to_llm(working_request, nav, scope_decision, candidate_contexts)

    def _track_nav_offer(self, request: AssistantRespondRequest, nav: NavOutcome) -> None:
        intent_telemetry.track_offer(
            user_id=request.userId,
            actions=nav.offered_actions,
            resolver_path=nav.path,
        )

    def _continue_to_llm(
        self,
        request: AssistantRespondRequest,
        nav: NavOutcome,
        scope_decision: ScopeDecision,
        contexts: list,
    ) -> GuardResult:
        """The turn goes to RAG + LLM; how-to navigation buttons ride along and are tracked as offered."""
        self._track_nav_offer(request, nav)
        return GuardResult(
            scope_decision=scope_decision,
            contexts=contexts,
            pending_actions=nav.howto_actions,
        )

    def _is_general_knowledge_only(self, scope_decision: ScopeDecision) -> bool:
        """True if every matched domain is general knowledge (mental_health/emotion).

        Feature questions ("does it have ... feature") are always treated as app-feature questions.
        """
        domains = scope_decision.matched_domains
        if not domains:
            return False
        if scope_decision.reason == "feature_question_in_domain_unknown":
            return False
        return set(domains).issubset(_GENERAL_KNOWLEDGE_DOMAINS)

    async def execute(self, request: AssistantRespondRequest) -> AssistantRespondData:
        started_at = time.perf_counter()
        request_id = str(uuid4())
        session_key = self._session_key(request)
        history = await self._resolve_history(request, session_key)
        last_intent = request.intent or await self.memory.get_last_intent(session_key)
        memory_facts = await self.memory.get_facts(session_key)
        effective_message, has_follow_up_anchor = await self._resolve_follow_up_message(
            request.message,
            history,
            memory_facts,
            request,
        )
        working_request = (
            request.model_copy(update={"message": effective_message})
            if effective_message != request.message
            else request
        )

        # --- Emotion snapshot (fire-and-forget timeout 500ms in service layer) ---
        emotion_snapshot: EmotionSnapshot = await self.emotion_ctx.get_snapshot(request.userId)

        guard = await self._run_guard_chain(
            working_request, history, last_intent, has_follow_up_anchor, emotion_snapshot
        )
        guard_data, guard_intent = guard.data, guard.intent
        scope_decision, candidate_contexts = guard.scope_decision, guard.contexts
        pending_actions = guard.pending_actions
        
        if guard_data:
            await self._persist_session_memory(request, guard_data.reply, [], guard_intent)
            persisted = await self.persist_history.execute(
                request=request,
                assistant_reply=guard_data.reply,
                sources=[],
                intent=guard_intent,
                actions=guard_data.suggestedActions,
            )
            return guard_data.model_copy(
                update={
                    "requestId": request_id,
                    "latencyMs": round((time.perf_counter() - started_at) * 1000, 2),
                    "persisted": persisted,
                    "conversationId": request.conversationId or "default",
                }
            )

        working_request = working_request.model_copy(update={"contexts": candidate_contexts})

        memory_summary = await self.memory.get_summary(session_key)
        memory_context = self._build_memory_context(memory_summary, memory_facts)
        prompt_limits = resolve_prompt_limits(request.userId)
        final_contexts = candidate_contexts[: prompt_limits.max_context_items]
        resolved_request = working_request.model_copy(update={"contexts": final_contexts})

        # Emotion snapshot already fetched early


        is_proactive_checkin = False
        # Proactive check-in: Proactively ask about the user's wellbeing if there is no chat history and check-in is needed
        if emotion_snapshot.needs_proactive_checkin and not history:
            is_proactive_checkin = True

        prompt = self.prompt_builder.build(
            resolved_request,
            history,
            memory_context,
            context_char_limit=prompt_limits.context_char_limit,
            max_history_items=prompt_limits.max_history_items,
            history_item_char_limit=prompt_limits.history_item_char_limit,
            context_total_char_limit=prompt_limits.context_total_char_limit,
            emotion_snapshot=emotion_snapshot,
            is_proactive_checkin=is_proactive_checkin,
        )
        prompt = self._prepend_turn_policy(prompt)

        # Check if active tools are available for surface
        active_tools = self.tool_router.get_openai_tools(resolved_request.surface)
        supports_tools = self._supports_tools(active_tools)

        llm_timeout_ms = settings.CHATBOT_LLM_TIMEOUT_MS
        generation: LlmGeneration
        try:
            async with _LLM_SEMAPHORE:
                if supports_tools:
                    generation = await asyncio.wait_for(
                        self.provider.generate(prompt, resolved_request, tools=active_tools),
                        timeout=max(llm_timeout_ms, 1) / 1000,
                    )
                else:
                    generation = await asyncio.wait_for(
                        self.provider.generate(prompt, resolved_request),
                        timeout=max(llm_timeout_ms, 1) / 1000,
                    )
        except asyncio.TimeoutError:
            generation = self._llm_timeout_generation()
        except Exception:
            logger.exception(
                "Assistant generation failed: userId=%s conversationId=%s contexts=%s",
                request.userId,
                request.conversationId,
                len(final_contexts),
            )
            raise

        generated_cards: list[ShowCardAction] = []
        tool_results_list: list[Any] = []
        tool_calls_tuple: tuple[Any, ...] = ()
        # If LLM requested tool calling, execute in parallel and synthesize in second pass
        if hasattr(generation, "tool_calls") and generation.tool_calls:
            tool_calls_tuple = tuple(generation.tool_calls)
            augmented_prompt, generated_cards, tool_results_list = await self._execute_tools_and_augment_prompt(
                generation.tool_calls, prompt, request
            )
            pending_actions.extend(generated_cards)
            try:
                async with _LLM_SEMAPHORE:
                    generation = await asyncio.wait_for(
                        self.provider.generate(augmented_prompt, resolved_request),
                        timeout=max(llm_timeout_ms, 1) / 1000,
                    )
            except asyncio.TimeoutError:
                generation = self._llm_timeout_generation()
            except Exception:
                logger.exception("Assistant tool synthesis generation failed")

        # Synthesize write action proposals (Zero Silent Mutation)
        cleaned_reply, reply_proposals = self._extract_proposals_from_llm_reply(generation.content)
        if not reply_proposals:
            reply_proposals = self._detect_action_proposals(request, tool_calls_tuple, tool_results_list)

        generated_proposals = reply_proposals[:3]
        pending_actions.extend(generated_proposals)
        pending_actions = pending_actions[:3]

        sources = [
            AssistantSource(
                type=item.type,
                id=item.id,
                title=item.title,
                source=item.source,
                score=item.score,
            )
            for item in final_contexts
        ]
        reply_content = self._sanitize_assistant_reply(cleaned_reply)
        resolved_intent = request.intent or self._infer_intent(
            final_contexts,
            fallback_domains=scope_decision.matched_domains,
        )
        await self._persist_session_memory(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=resolved_intent,
        )
        persisted = await self.persist_history.execute(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=resolved_intent,
            actions=pending_actions,
        )

        return AssistantRespondData(
            type="fallback" if generation.model == "timeout-guard" else "answer",
            reply=reply_content,
            sources=sources,
            suggestedActions=pending_actions,
            cards=generated_cards[:3],
            proposals=generated_proposals,
            model=generation.model,
            provider=generation.provider,
            requestId=request_id,
            latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
            persisted=persisted,
            conversationId=request.conversationId or "default",
        )

    def _supports_tools(self, active_tools: list[dict[str, Any]]) -> bool:
        if not active_tools:
            return False
        try:
            import inspect
            sig = inspect.signature(self.provider.generate)
            return "tools" in sig.parameters
        except Exception:
            return False

    def _extract_cards(
        self,
        tool_calls: tuple[Any, ...],
        tool_results: list[Any],
    ) -> list[ShowCardAction]:
        cards: list[ShowCardAction] = []
        for tc, res in zip(tool_calls, tool_results):
            if not getattr(res, "success", False) or getattr(res, "data", None) is None:
                continue
            data = res.data
            name = getattr(tc, "name", "")

            # 1. Profile cards
            if name in ("get_my_friends", "search_users", "get_friend_recommendations", "get_my_friend_requests"):
                user_list = []
                if isinstance(data, dict):
                    user_list = data.get("friends") or data.get("users") or data.get("recommendations") or data.get("requests") or []
                elif isinstance(data, list):
                    user_list = data
                for u in user_list[:2]:
                    if isinstance(u, dict):
                        u_name = u.get("name") or u.get("senderName") or u.get("username") or "Người dùng"
                        u_sub = f"@{u['username']}" if u.get("username") else (f"{u.get('mutualFriends', 0)} bạn chung" if u.get("mutualFriends") else "Thành viên Sentimeta")
                        username_or_id = u.get("username") or u.get("id") or u.get("targetUserId") or ""
                        cards.append(
                            ShowCardAction(
                                label="Xem trang cá nhân",
                                payload=CardPayload(
                                    cardType="profile",
                                    title=u_name,
                                    subtitle=u_sub,
                                    imageUrl=u.get("avatarUrl"),
                                    actionUrl=f"/profile/{username_or_id}" if username_or_id else "/friends",
                                    actionLabel="Xem trang cá nhân",
                                    metadata={"userId": u.get("id"), "username": u.get("username")},
                                ),
                            )
                        )

            # 2. Group cards
            elif name in ("get_group_context", "get_my_groups", "get_group_recommendations", "get_group_invitations"):
                group_list = []
                if isinstance(data, dict):
                    group_list = data.get("groups") or data.get("recommendations") or data.get("invitations") or [data]
                elif isinstance(data, list):
                    group_list = data
                for g in group_list[:2]:
                    if isinstance(g, dict) and (g.get("id") or g.get("name")):
                        g_name = g.get("name") or "Nhóm cộng đồng"
                        m_count = g.get("memberCount") or g.get("membersCount") or 0
                        g_sub = f"{m_count} thành viên" if m_count else "Cộng đồng Sentimeta"
                        g_id = g.get("id") or g.get("groupId") or ""
                        cards.append(
                            ShowCardAction(
                                label="Xem nhóm",
                                payload=CardPayload(
                                    cardType="group",
                                    title=g_name,
                                    subtitle=g_sub,
                                    imageUrl=g.get("avatarUrl") or g.get("coverUrl"),
                                    actionUrl=f"/groups/{g_id}" if g_id else "/groups",
                                    actionLabel="Xem nhóm",
                                    metadata={"groupId": g_id},
                                ),
                            )
                        )

            # 3. Music cards
            elif name == "get_recommended_music_for_mood":
                track_list = []
                if isinstance(data, dict):
                    track_list = data.get("tracks") or data.get("data") or data.get("recommendations") or [data]
                elif isinstance(data, list):
                    track_list = data
                for t in track_list[:2]:
                    if isinstance(t, dict):
                        t_title = t.get("title") or t.get("name") or "Bài hát thư giãn"
                        t_artist = t.get("artist") or "Nghệ sĩ Sentimeta"
                        cards.append(
                            ShowCardAction(
                                label="Nghe thử",
                                payload=CardPayload(
                                    cardType="music",
                                    title=t_title,
                                    subtitle=t_artist,
                                    imageUrl=t.get("coverUrl") or t.get("thumbnailUrl"),
                                    actionUrl=t.get("previewUrl") or t.get("streamUrl") or f"/music/{t.get('id', '')}",
                                    actionLabel="Nghe thử",
                                    metadata={"trackId": t.get("id"), "previewUrl": t.get("previewUrl")},
                                ),
                            )
                        )

            # 4. Post cards
            elif name in ("get_trending_posts", "get_my_posts_overview", "get_my_saved_posts"):
                post_list = []
                if isinstance(data, dict):
                    post_list = data.get("posts") or data.get("data") or [data]
                elif isinstance(data, list):
                    post_list = data
                for p in post_list[:2]:
                    if isinstance(p, dict) and (p.get("id") or p.get("content")):
                        p_author = p.get("authorName") or "Bài viết nổi bật"
                        p_content = str(p.get("content", ""))
                        p_sub = (p_content[:75] + "...") if len(p_content) > 75 else p_content
                        p_id = p.get("id") or ""
                        cards.append(
                            ShowCardAction(
                                label="Xem bài viết",
                                payload=CardPayload(
                                    cardType="post",
                                    title=p_author,
                                    subtitle=p_sub,
                                    imageUrl=p.get("thumbnailUrl"),
                                    actionUrl=f"/posts/{p_id}" if p_id else "/feed",
                                    actionLabel="Xem bài viết",
                                    metadata={"postId": p_id},
                                ),
                            )
                        )

            # 5. Emotion cards
            elif name in ("get_my_emotion_summary", "get_my_emotion_trends"):
                if isinstance(data, dict):
                    dominant = data.get("dominantEmotion") or data.get("topEmotion")
                    if dominant:
                        cards.append(
                            ShowCardAction(
                                label="Xem phân tích",
                                payload=CardPayload(
                                    cardType="emotion",
                                    title=f"Tâm trạng: {dominant}",
                                    subtitle="Báo cáo phân tích cảm xúc cá nhân gần đây",
                                    actionUrl="/emotions",
                                    actionLabel="Xem phân tích cảm xúc",
                                    metadata=data,
                                ),
                            )
                        )

        return cards[:2]

    async def _execute_tools_and_augment_prompt(
        self,
        tool_calls: tuple[Any, ...],
        prompt: str,
        request: AssistantRespondRequest,
    ) -> tuple[str, list[ShowCardAction], list[Any]]:
        exec_ctx = ToolExecutionContext(
            user_id=request.userId,
            surface=request.surface,
            auth_token=request.authToken,
        )
        # Execute tool calls concurrently for optimal latency
        tool_results = await asyncio.gather(
            *(self.dispatcher.dispatch(tc.name, tc.args, exec_ctx) for tc in tool_calls)
        )
        tool_results_list = list(tool_results)
        cards = self._extract_cards(tool_calls, tool_results_list)
        tool_results_text = [
            f"- Công cụ `{tc.name}`: {res.to_tool_message_content()}"
            for tc, res in zip(tool_calls, tool_results)
        ]

        augmented_prompt = (
            f"{prompt}\n\n"
            "[KẾT QUẢ TRẢ VỀ TỪ CÔNG CỤ HỆ THỐNG]:\n"
            + "\n".join(tool_results_text)
            + "\nHãy tổng hợp thông tin trên thành câu trả lời tự nhiên, thân thiện và chính xác cho người dùng."
        )
        return augmented_prompt, cards, tool_results_list

    def _extract_proposals_from_llm_reply(
        self,
        reply: str,
    ) -> tuple[str, list[ProposeAction]]:
        """Extract structured ```action { ... } ``` proposals from the LLM reply and sanitize."""
        pattern = re.compile(r"```(?:action|json:action)\s*(\{.*?\})\s*```", re.DOTALL)
        proposals: list[ProposeAction] = []

        for m in pattern.finditer(reply):
            raw_json = m.group(1).strip()
            try:
                data = json.loads(raw_json)
                action_name = data.get("actionName") or data.get("action")
                if action_name and is_action_allowed(action_name):
                    action_def = get_action_definition(action_name)
                    title = data.get("title") or (action_def.description if action_def else action_name)
                    desc = data.get("description") or (action_def.description if action_def else "")
                    params = data.get("params") if isinstance(data.get("params"), dict) else {}
                    confirm_lbl = data.get("confirmLabel") or (action_def.confirm_label if action_def else "Xác nhận")
                    cancel_lbl = data.get("cancelLabel") or (action_def.cancel_label if action_def else "Hủy")
                    category = data.get("category") or (action_def.category if action_def else "social")
                    is_destructive = data.get("isDestructive") if "isDestructive" in data else (action_def.is_destructive if action_def else False)

                    proposals.append(
                        ProposeAction(
                            label=confirm_lbl,
                            payload=ProposeActionPayload(
                                actionName=action_name,
                                title=title,
                                description=desc,
                                params=params,
                                idempotencyKey=str(uuid4()),
                                confirmLabel=confirm_lbl,
                                cancelLabel=cancel_lbl,
                                category=category,
                                isDestructive=is_destructive,
                            ),
                        )
                    )
            except Exception as exc:
                logger.warning("Failed to parse action proposal from LLM output: %s", exc)

        cleaned_reply = pattern.sub("", reply).strip()
        return cleaned_reply, proposals

    def _detect_action_proposals(
        self,
        request: AssistantRespondRequest,
        tool_calls: tuple[Any, ...],
        tool_results: list[Any],
    ) -> list[ProposeAction]:
        """Synthesize write action proposals based on user intent, surface context, and tool results."""
        proposals: list[ProposeAction] = []
        msg = (request.message or "").lower()

        # Reject negative/refusal intents to avoid false-positive action proposals
        # e.g., "Tôi không muốn kết bạn", "Đừng gửi lời mời", "Chưa muốn vào nhóm"
        if any(neg in msg for neg in ("không muốn", "đừng", "chưa muốn", "không cần", "don't want", "do not")):
            return []

        # 1. Mark all notifications as read
        if any(kw in msg for kw in ("đọc hết thông báo", "đánh dấu đã đọc", "mark all notifications", "đọc tất cả thông báo")):
            action_def = get_action_definition("mark_all_notifications_read")
            if action_def:
                proposals.append(
                    ProposeAction(
                        label=action_def.confirm_label,
                        payload=ProposeActionPayload(
                            actionName="mark_all_notifications_read",
                            title="Đánh dấu đã đọc",
                            description="Đánh dấu toàn bộ thông báo của bạn là đã đọc",
                            params={},
                            idempotencyKey=str(uuid4()),
                            confirmLabel=action_def.confirm_label,
                            cancelLabel=action_def.cancel_label,
                            category=action_def.category,
                            isDestructive=action_def.is_destructive,
                        ),
                    )
                )

        # 2. Friend interactions (send / accept / decline / cancel / unfriend)
        if any(kw in msg for kw in ("kết bạn", "gửi kết bạn", "add friend", "lời mời kết bạn", "chấp nhận", "đồng ý", "thu hồi", "hủy", "từ chối", "bỏ qua", "decline", "unfriend", "xóa bạn")):
            # Check decline friend request
            if any(kw in msg for kw in ("từ chối", "bỏ qua", "decline", "reject")):
                requester_id = None
                requester_name = "người dùng"
                for tc, res in zip(tool_calls, tool_results):
                    if getattr(tc, "name", "") == "get_my_friend_requests" and getattr(res, "success", False):
                        reqs = res.data.get("requests", []) if isinstance(res.data, dict) else res.data
                        if isinstance(reqs, list) and reqs:
                            first_req = reqs[0]
                            requester_id = first_req.get("senderId") or first_req.get("requesterId") or first_req.get("id")
                            requester_name = first_req.get("senderName") or first_req.get("name") or "người dùng"
                            break
                if not requester_id and request.surface and request.surface.entityId and "profile" in (request.surface.screen or ""):
                    requester_id = request.surface.entityId
                    requester_name = (request.surface.metadata or {}).get("userName") or "người dùng"
                if requester_id:
                    action_def = get_action_definition("decline_friend_request")
                    if action_def:
                        proposals.append(
                            ProposeAction(
                                label=action_def.confirm_label,
                                payload=ProposeActionPayload(
                                    actionName="decline_friend_request",
                                    title="Từ chối kết bạn",
                                    description=f"Từ chối lời mời kết bạn từ {requester_name}",
                                    params={"requester_id": requester_id},
                                    idempotencyKey=str(uuid4()),
                                    confirmLabel=action_def.confirm_label,
                                    cancelLabel=action_def.cancel_label,
                                    category=action_def.category,
                                    isDestructive=action_def.is_destructive,
                                ),
                            )
                        )
            # Check accept
            elif any(kw in msg for kw in ("đồng ý", "chấp nhận", "accept")):
                requester_id = None
                requester_name = "người dùng"
                for tc, res in zip(tool_calls, tool_results):
                    if getattr(tc, "name", "") == "get_my_friend_requests" and getattr(res, "success", False):
                        reqs = res.data.get("requests", []) if isinstance(res.data, dict) else res.data
                        if isinstance(reqs, list) and reqs:
                            first_req = reqs[0]
                            requester_id = first_req.get("senderId") or first_req.get("requesterId") or first_req.get("id")
                            requester_name = first_req.get("senderName") or first_req.get("name") or "người dùng"
                            break
                if requester_id:
                    action_def = get_action_definition("accept_friend_request")
                    if action_def:
                        proposals.append(
                            ProposeAction(
                                label=action_def.confirm_label,
                                payload=ProposeActionPayload(
                                    actionName="accept_friend_request",
                                    title="Đồng ý kết bạn",
                                    description=f"Chấp nhận lời mời kết bạn từ {requester_name}",
                                    params={"requester_id": requester_id},
                                    idempotencyKey=str(uuid4()),
                                    confirmLabel=action_def.confirm_label,
                                    cancelLabel=action_def.cancel_label,
                                    category=action_def.category,
                                    isDestructive=action_def.is_destructive,
                                ),
                            )
                        )
            # Check unfriend
            elif any(kw in msg for kw in ("hủy kết bạn", "xóa bạn", "unfriend")):
                target_user_id = (
                    request.surface.entityId
                    if (request.surface and "profile" in (request.surface.screen or ""))
                    else None
                )
                target_name = (request.surface.metadata or {}).get("userName") or "người dùng" if request.surface else "người dùng"
                if not target_user_id:
                    for tc, res in zip(tool_calls, tool_results):
                        if getattr(tc, "name", "") in ("search_users", "get_user_friends") and getattr(res, "success", False):
                            users = res.data.get("users", []) if isinstance(res.data, dict) else (res.data.get("friends", []) if isinstance(res.data, dict) else res.data)
                            if isinstance(users, list) and users:
                                first_u = users[0]
                                target_user_id = first_u.get("id") or first_u.get("userId")
                                target_name = first_u.get("name") or first_u.get("username") or "người dùng"
                                break
                if target_user_id:
                    action_def = get_action_definition("unfriend_user")
                    if action_def:
                        proposals.append(
                            ProposeAction(
                                label=action_def.confirm_label,
                                payload=ProposeActionPayload(
                                    actionName="unfriend_user",
                                    title=f"Hủy kết bạn với {target_name}",
                                    description=f"Hủy quan hệ bạn bè với {target_name}",
                                    params={"target_user_id": target_user_id},
                                    idempotencyKey=str(uuid4()),
                                    confirmLabel=action_def.confirm_label,
                                    cancelLabel=action_def.cancel_label,
                                    category=action_def.category,
                                    isDestructive=action_def.is_destructive,
                                ),
                            )
                        )
            # Check cancel friend request
            elif any(kw in msg for kw in ("hủy", "thu hồi", "cancel")):
                target_user_id = (
                    request.surface.entityId
                    if (request.surface and "profile" in (request.surface.screen or ""))
                    else None
                )
                if target_user_id:
                    action_def = get_action_definition("cancel_friend_request")
                    if action_def:
                        proposals.append(
                            ProposeAction(
                                label=action_def.confirm_label,
                                payload=ProposeActionPayload(
                                    actionName="cancel_friend_request",
                                    title="Thu hồi lời mời",
                                    description="Thu hồi lời mời kết bạn đã gửi",
                                    params={"target_user_id": target_user_id},
                                    idempotencyKey=str(uuid4()),
                                    confirmLabel=action_def.confirm_label,
                                    cancelLabel=action_def.cancel_label,
                                    category=action_def.category,
                                    isDestructive=action_def.is_destructive,
                                ),
                            )
                        )
            # Send friend request
            elif any(kw in msg for kw in ("kết bạn", "gửi kết bạn", "add friend")):
                target_user_id = None
                target_name = "người dùng"
                for tc, res in zip(tool_calls, tool_results):
                    if getattr(tc, "name", "") in ("search_users", "get_friend_recommendations") and getattr(res, "success", False):
                        users = res.data.get("users", []) if isinstance(res.data, dict) else res.data
                        if isinstance(users, list) and users:
                            first_u = users[0]
                            target_user_id = first_u.get("id") or first_u.get("userId")
                            target_name = first_u.get("name") or first_u.get("username") or "người dùng"
                            break

                if not target_user_id and request.surface and request.surface.entityId and "profile" in (request.surface.screen or ""):
                    target_user_id = request.surface.entityId
                    target_name = (request.surface.metadata or {}).get("userName") or "người dùng"

                if target_user_id:
                    action_def = get_action_definition("send_friend_request")
                    if action_def:
                        proposals.append(
                            ProposeAction(
                                label=action_def.confirm_label,
                                payload=ProposeActionPayload(
                                    actionName="send_friend_request",
                                    title=f"Gửi kết bạn tới {target_name}",
                                    description=f"Gửi lời mời kết bạn tới {target_name}",
                                    params={"target_user_id": target_user_id},
                                    idempotencyKey=str(uuid4()),
                                    confirmLabel=action_def.confirm_label,
                                    cancelLabel=action_def.cancel_label,
                                    category=action_def.category,
                                    isDestructive=action_def.is_destructive,
                                ),
                            )
                        )

        # 3. Block user
        if any(kw in msg for kw in ("chặn", "block")):
            target_user_id = (
                request.surface.entityId
                if (request.surface and "profile" in (request.surface.screen or ""))
                else None
            )
            target_name = (request.surface.metadata or {}).get("userName") or "người này" if request.surface else "người này"
            if not target_user_id:
                for tc, res in zip(tool_calls, tool_results):
                    if getattr(tc, "name", "") in ("search_users",) and getattr(res, "success", False):
                        users = res.data.get("users", []) if isinstance(res.data, dict) else res.data
                        if isinstance(users, list) and users:
                            first_u = users[0]
                            target_user_id = first_u.get("id") or first_u.get("userId")
                            target_name = first_u.get("name") or first_u.get("username") or "người này"
                            break
            if target_user_id:
                action_def = get_action_definition("block_user")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="block_user",
                                title=f"Chặn người dùng {target_name}",
                                description=f"Chặn {target_name} để dừng mọi liên lạc và tương tác",
                                params={"target_user_id": target_user_id},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )

        # 4. Community Group interactions (join / leave)
        if any(kw in msg for kw in ("nhóm", "group")):
            if any(kw in msg for kw in ("tham gia", "vào nhóm", "join")):
                group_id = None
                group_name = "nhóm"
                for tc, res in zip(tool_calls, tool_results):
                    if getattr(tc, "name", "") == "search_groups" and getattr(res, "success", False):
                        groups = res.data.get("groups", []) if isinstance(res.data, dict) else res.data
                        if isinstance(groups, list) and groups:
                            first_g = groups[0]
                            group_id = first_g.get("id") or first_g.get("groupId")
                            group_name = first_g.get("name") or "nhóm"
                            break
                if not group_id and request.surface and request.surface.entityId and "group" in (request.surface.screen or ""):
                    group_id = request.surface.entityId
                    group_name = (request.surface.metadata or {}).get("groupName") or "nhóm này"

                if group_id:
                    action_def = get_action_definition("join_group")
                    if action_def:
                        proposals.append(
                            ProposeAction(
                                label=action_def.confirm_label,
                                payload=ProposeActionPayload(
                                    actionName="join_group",
                                    title=f"Tham gia nhóm {group_name}",
                                    description=f"Gửi yêu cầu hoặc tham gia nhóm {group_name}",
                                    params={"group_id": group_id},
                                    idempotencyKey=str(uuid4()),
                                    confirmLabel=action_def.confirm_label,
                                    cancelLabel=action_def.cancel_label,
                                    category=action_def.category,
                                    isDestructive=action_def.is_destructive,
                                ),
                            )
                        )
            elif any(kw in msg for kw in ("rời", "thoát", "leave")):
                group_id = (
                    request.surface.entityId
                    if (request.surface and "group" in (request.surface.screen or ""))
                    else None
                )
                group_name = (request.surface.metadata or {}).get("groupName", "nhóm") if request.surface else "nhóm"
                if group_id:
                    action_def = get_action_definition("leave_group")
                    if action_def:
                        proposals.append(
                            ProposeAction(
                                label=action_def.confirm_label,
                                payload=ProposeActionPayload(
                                    actionName="leave_group",
                                    title=f"Rời nhóm {group_name}",
                                    description=f"Rời khỏi nhóm {group_name}",
                                    params={"group_id": group_id},
                                    idempotencyKey=str(uuid4()),
                                    confirmLabel=action_def.confirm_label,
                                    cancelLabel=action_def.cancel_label,
                                    category=action_def.category,
                                    isDestructive=action_def.is_destructive,
                                ),
                            )
                        )

        # 5. Post Reaction interactions
        if any(kw in msg for kw in ("thích", "thả tim", "like bài", "bài viết này", "react")):
            post_id = None
            if request.surface and "post" in (request.surface.screen or ""):
                post_id = request.surface.entityId
            if not post_id:
                for tc, res in zip(tool_calls, tool_results):
                    if getattr(tc, "name", "") in ("get_trending_posts", "get_my_posts_overview") and getattr(res, "success", False):
                        posts = res.data.get("posts", []) if isinstance(res.data, dict) else res.data
                        if isinstance(posts, list) and posts:
                            first_p = posts[0]
                            post_id = first_p.get("id") or first_p.get("postId")
                            break
            if post_id:
                rxn = "love" if any(w in msg for w in ("tim", "love")) else "like"
                action_def = get_action_definition("react_post")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="react_post",
                                title=f"Thả cảm xúc ({rxn})",
                                description=f"Bày tỏ cảm xúc '{rxn}' cho bài viết",
                                params={"post_id": post_id, "reaction_type": rxn},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )

        # Deduplicate proposals by (actionName, str(params))
        seen = set()
        deduped = []
        for p in proposals:
            key = (p.payload.actionName, json.dumps(p.payload.params, sort_keys=True))
            if key not in seen:
                seen.add(key)
                deduped.append(p)
        return deduped[:2]

    async def _resolve_history(self, request: AssistantRespondRequest, session_key: str):
        if request.history:
            return request.history[-settings.CHATBOT_MEMORY_RECENT_ITEMS :]
        return await self.memory.get_recent(session_key, settings.CHATBOT_MEMORY_RECENT_ITEMS)

    def _session_key(self, request: AssistantRespondRequest) -> str:
        return f"{request.userId}:default"

    async def _resolve_contexts_with_budget(
        self,
        request: AssistantRespondRequest,
        timeout_ms: int,
        emotion_snapshot: EmotionSnapshot,
    ):
        timeout_seconds = max(timeout_ms, 1) / 1000
        try:
            return await asyncio.wait_for(
                self.context_resolver.resolve(request, emotion_snapshot),
                timeout=timeout_seconds,
            )
        except Exception:
            return self._dedupe_contexts(request.contexts)

    async def _persist_session_memory(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ):
        session_key = self._session_key(request)
        memory_summary = await self.memory.get_summary(session_key)
        updated_summary = self._build_updated_summary(
            memory_summary,
            request.message,
            assistant_reply,
        )
        facts = {
            "last_intent": intent or "",
            "last_user_message": self._truncate_text(request.message, 140),
            "last_assistant_reply": self._truncate_text(assistant_reply, 180),
        }
        await self.memory.update_session_batch(
            key=session_key,
            user_message=request.message,
            assistant_reply=assistant_reply,
            summary=updated_summary,
            intent=intent,
            sources=sources,
            facts=facts,
        )

    def _build_updated_summary(
        self,
        current_summary: str,
        user_message: str,
        assistant_reply: str,
    ) -> str:
        latest = (
            "Lượt gần nhất: "
            f"Người dùng hỏi '{self._truncate_text(user_message, 180)}'. "
            f"Assistant trả lời '{self._truncate_text(assistant_reply, 260)}'."
        )
        combined = " ".join(part for part in [current_summary, latest] if part)
        return self._truncate_text(combined, settings.CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT)

    def _build_memory_context(self, summary: str, facts: dict[str, str]) -> str:
        if not facts:
            return summary
        fact_lines = [f"{key}: {value}" for key, value in facts.items() if value]
        facts_block = "\n".join(fact_lines[:8])
        payload = {
            "summary": summary,
            "facts": facts_block,
        }
        return self._truncate_text(
            json.dumps(payload, ensure_ascii=False),
            settings.CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT,
        )

    def _infer_intent(
        self,
        contexts,
        fallback_domains: tuple[str, ...] = (),
    ) -> str | None:
        if not contexts:
            return fallback_domains[0] if fallback_domains else None
        first_type = contexts[0].type
        if first_type in {"post", "group", "user", "help_doc"}:
            return first_type
        return fallback_domains[0] if fallback_domains else None

    def _truncate_text(self, value: str, limit: int) -> str:
        normalized = " ".join(str(value or "").split())
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[:limit].rstrip()}..."

    def _dedupe_contexts(self, contexts):
        result = []
        seen: set[tuple[str, str]] = set()
        for item in contexts:
            key = (item.type, item.id)
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
        return result

    def _llm_timeout_generation(self) -> LlmGeneration:
        return LlmGeneration(
            content=(
                "Hệ thống đang chậm hơn bình thường. "
                "Bạn thử gửi câu hỏi ngắn hơn hoặc thử lại sau vài giây."
            ),
            model="timeout-guard",
            provider="chatbot-service",
        )

    def _sanitize_assistant_reply(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return text
        text = re.sub(
            r"^\s*(assistant|ai assistant|bot|assistant reply)\s*[:\-]\s*",
            "",
            text,
            flags=re.IGNORECASE,
        )
        return text.strip()

    def _prepend_turn_policy(self, prompt: str) -> str:
        policy = (
            "TURN_POLICY:\n"
            "- User did not greet in this turn.\n"
            "- Start directly with the answer content.\n"
            "- Do not open with greeting words (e.g., xin chao/hello/hi).\n"
        )
        return f"{policy}\n{prompt}"

    async def _resolve_follow_up_message(
        self,
        message: str,
        history: list[AssistantHistoryItem],
        memory_facts: dict[str, str],
        request: AssistantRespondRequest,
    ) -> tuple[str, bool]:
        normalized = self.scope_guard._normalize(message)
        if not self._is_follow_up_reference(normalized):
            return message, False

        anchor = self._pick_recent_user_anchor(history, memory_facts)
        if not anchor:
            return message, False

        rewrite_prompt = (
            "Dựa vào câu hỏi mới nhất và lịch sử hội thoại trước đó, "
            "hãy viết lại câu hỏi mới nhất thành một câu hỏi độc lập và đầy đủ ngữ nghĩa, "
            "nhưng ngắn gọn nhất có thể. KHÔNG trả lời câu hỏi, CHỈ viết lại câu hỏi.\n\n"
            f"Lịch sử:\nUser: {anchor}\n\n"
            f"Câu hỏi mới nhất: {message}\n\n"
            "Câu hỏi độc lập:"
        )

        try:
            generation = await asyncio.wait_for(
                self.provider.generate(rewrite_prompt, request),
                timeout=3.0,
            )
            rewritten = generation.content.strip(" \"'\n")
            if rewritten:
                return rewritten, True
        except Exception as exc:
            logger.warning("Query rewrite failed, falling back to anchor: %s", exc)

        rewritten = f"{message.strip()} {anchor}"
        return rewritten, True

    def _pick_recent_user_anchor(
        self,
        history: list[AssistantHistoryItem],
        memory_facts: dict[str, str],
    ) -> str:
        for item in reversed(history[-10:]):
            if item.role != "user":
                continue
            content = " ".join(str(item.content or "").split())
            if not content:
                continue
            if content == memory_facts.get("last_user_message", ""):
                continue
            normalized = self.scope_guard._normalize(content)
            if normalized in {"hi", "hello", "hey", "xin chao", "chao"}:
                continue
            if len(normalized.split()) <= 2:
                continue
            if self._is_follow_up_reference(normalized):
                continue
            return self._truncate_text(content, 220)
        fallback = memory_facts.get("last_user_message", "")
        return self._truncate_text(fallback, 220) if fallback else ""

    def _is_follow_up_reference(self, normalized_message: str) -> bool:
        if not normalized_message:
            return False
        patterns = (
            r"\b(no|cai do|cai nay|truoc do|y truoc do|van de truoc do)\b",
            r"\b(giai thich them|noi ro hon|chi tiet hon|tiep theo)\b",
            r"\b(nhu vay|nhu tren|phan do|muc do)\b",
        )
        return any(re.search(pattern, normalized_message) for pattern in patterns)

    def _in_domain_unknown_response(
        self,
        matched_domains: tuple[str, ...],
    ) -> AssistantRespondData:
        domain_hint = ", ".join(matched_domains[:3]) if matched_domains else "hệ thống Sentimeta"
        return AssistantRespondData(
            reply=(
                f"Câu hỏi của bạn vẫn thuộc phạm vi {domain_hint}, "
                "nhưng hiện mình chưa có đủ dữ liệu hoặc tài liệu để trả lời chính xác tính năng này. "
                "Bạn có thể mô tả rõ hơn màn hình hoặc thao tác đang dùng để mình hỗ trợ theo hướng gần nhất."
            ),
            sources=[],
            suggestedActions=[],
            type="no_answer",
            model="scope-guard",
            provider="chatbot-service",
        )

    def _privacy_policy_response(self) -> AssistantRespondData:
        return AssistantRespondData(
            reply=(
                "Mình có thể hỗ trợ câu hỏi về quyền riêng tư trên Sentimeta. "
                "Hiện tại mình chưa có trích dẫn chính sách cụ thể trong context để xác nhận chi tiết điều khoản. "
                "Bạn có thể nêu rõ mục bạn cần (dữ liệu cá nhân, quyền truy cập, chặn người dùng, xoá tài khoản) để mình hướng dẫn theo luồng sử dụng phù hợp."
            ),
            sources=[],
            suggestedActions=[],
            type="no_answer",
            model="scope-guard",
            provider="chatbot-service",
        )

    def _out_of_scope_response(self) -> AssistantRespondData:
        return AssistantRespondData(
            reply=(
                "Mình chỉ hỗ trợ các câu hỏi liên quan đến hệ thống Sentimeta "
                "(bài viết, nhóm, chat...) và chia sẻ kiến thức, kỹ năng "
                "chăm sóc sức khỏe tinh thần."
            ),
            sources=[],
            suggestedActions=[],
            type="out_of_scope",
            model="scope-guard",
            provider="chatbot-service",
        )

    def _greeting_response(self) -> AssistantRespondData:
        return AssistantRespondData(
            reply=(
                "Xin chào! Mình là trợ lý của Sentimeta. "
                "Bạn cần mình hỗ trợ về tính năng ứng dụng, hay muốn chia sẻ, "
                "tìm hiểu về các kỹ năng chăm sóc sức khỏe tinh thần?"
            ),
            sources=[],
            suggestedActions=[],
            type="greeting",
            model="greeting-guard",
            provider="chatbot-service",
        )

    def _ambiguous_scope_response(self, matched_domains: tuple[str, ...]) -> AssistantRespondData:
        domain_hint = ", ".join(matched_domains[:3]) if matched_domains else "hệ thống Sentimeta"
        return AssistantRespondData(
            reply=(
                "Mình chưa chắc bạn đang hỏi phần nào. "
                f"Bạn muốn mình hỗ trợ về {domain_hint} hay phần khác trong Sentimeta? "
                "Bạn có thể nói rõ mục tiêu trong 1 câu."
            ),
            sources=[],
            suggestedActions=[],
            type="clarify",
            model="scope-guard",
            provider="chatbot-service",
        )

    def _community_response(self, reason: str) -> AssistantRespondData:
        if reason == "community_violation":
            message = (
                "Mình không thể hỗ trợ nội dung vi phạm tiêu chuẩn cộng đồng. "
                "Bạn hãy đổi sang câu hỏi an toàn và phù hợp hơn để mình hỗ trợ tiếp."
            )
        else:
            message = (
                "Mình chưa thể xử lý câu có từ ngữ tục tĩu hoặc xúc phạm. "
                "Bạn có thể diễn đạt lại lịch sự hơn để mình hỗ trợ chính xác."
            )
        return AssistantRespondData(
            reply=message,
            sources=[],
            suggestedActions=[],
            type="community_blocked",
            model="community-guard",
            provider="chatbot-service",
        )

    def _build_crisis_response(
        self,
        reply: str,
        severity: str,
        notification_sent: bool,
    ) -> AssistantRespondData:
        return AssistantRespondData(
            type="crisis",
            reply=reply,
            sources=[],
            suggestedActions=[],
            model="crisis-guard",
            provider="chatbot-service",
            crisis=CrisisInfo(
                severity="high" if severity == "high" else "medium",
                resources=[
                    CrisisResource(name=name, phone=phone)
                    for name, phone in CRISIS_RESOURCES
                ],
                notificationSent=notification_sent,
            ),
        )

    async def _emit_crisis_event(
        self,
        request: AssistantRespondRequest,
        severity: str,
        rule: str,
    ) -> bool:
        """Emit a Kafka event alerting the support team about a mental health crisis.

        The payload does NOT contain the message text (to minimize personal data): `reason` is a
        fixed neutral description chosen by rule code (e.g. explicit_crisis). Field names
        `riskLevel`/`reason` and the `crisis`/`high` values are kept for compatibility with the
        emotion-intelligence-service consumer.

        Returns True only if the event was sent successfully within the allowed time.
        """
        try:
            kafka_producer = self._kafka_producer
            outbox_repo = self._outbox_repo
            if kafka_producer is None or outbox_repo is None:
                from app.core.messaging import get_kafka_producer, get_outbox_repo

                kafka_producer = kafka_producer or get_kafka_producer()
                outbox_repo = outbox_repo or get_outbox_repo()
            from datetime import datetime, timezone

            timestamp_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            payload = {
                "userId": request.userId,
                "conversationId": request.conversationId or "default",
                "riskLevel": _ALERT_RISK_LEVEL.get(severity, "crisis"),
                "reason": _ALERT_REASON.get(rule, _ALERT_REASON_DEFAULT),
                "timestamp": timestamp_str,
            }
            kafka_msg = {
                "type": "chatbot_crisis_alert",
                "payload": payload,
            }

            try:
                await asyncio.wait_for(
                    kafka_producer.send("chatbot.crisis.alert", kafka_msg),
                    timeout=_CRISIS_ALERT_TIMEOUT_SECONDS,
                )
                return True
            except Exception as exc:
                logger.warning("[CrisisGuard] Kafka emit failed, saving to DLQ/Outbox: %s", exc)
                outbox_data = {
                    "topic": "chatbot.crisis.alert",
                    "eventType": "chatbot_crisis_alert",
                    "payload": payload,
                    "processed": False,
                    "createdAt": timestamp_str,
                }
                await outbox_repo.save_outbox(outbox_data)
                return True

        except Exception as exc:  # noqa: BLE001
            logger.warning("[CrisisGuard] Failed to handle crisis alert (Kafka & Outbox failed): %s", exc)
            return False

    async def execute_stream(self, request: AssistantRespondRequest) -> AsyncIterator[AssistantRespondData]:
        started_at = time.perf_counter()
        request_id = str(uuid4())
        session_key = self._session_key(request)
        history = await self._resolve_history(request, session_key)
        last_intent = request.intent or await self.memory.get_last_intent(session_key)
        memory_facts = await self.memory.get_facts(session_key)
        effective_message, has_follow_up_anchor = await self._resolve_follow_up_message(
            request.message,
            history,
            memory_facts,
            request,
        )
        working_request = (
            request.model_copy(update={"message": effective_message})
            if effective_message != request.message
            else request
        )

        # --- Emotion snapshot (fire-and-forget timeout 500ms in service layer) ---
        emotion_snapshot: EmotionSnapshot = await self.emotion_ctx.get_snapshot(request.userId)

        guard = await self._run_guard_chain(
            working_request, history, last_intent, has_follow_up_anchor, emotion_snapshot
        )
        guard_data, guard_intent = guard.data, guard.intent
        scope_decision, candidate_contexts = guard.scope_decision, guard.contexts
        pending_actions = guard.pending_actions
        
        if guard_data:
            yield self._finalize_stream_data(guard_data, request_id, started_at, request)
            await self._after_generation(
                request, guard_data.reply, [], guard_intent, actions=guard_data.suggestedActions
            )
            return

        working_request = working_request.model_copy(update={"contexts": candidate_contexts})

        memory_summary = await self.memory.get_summary(session_key)
        memory_context = self._build_memory_context(memory_summary, memory_facts)
        prompt_limits = resolve_prompt_limits(request.userId)
        final_contexts = candidate_contexts[: prompt_limits.max_context_items]
        resolved_request = working_request.model_copy(update={"contexts": final_contexts})
        is_proactive_checkin = False
        if emotion_snapshot.needs_proactive_checkin and not history:
            is_proactive_checkin = True

        prompt = self.prompt_builder.build(
            resolved_request,
            history,
            memory_context,
            context_char_limit=prompt_limits.context_char_limit,
            max_history_items=prompt_limits.max_history_items,
            history_item_char_limit=prompt_limits.history_item_char_limit,
            context_total_char_limit=prompt_limits.context_total_char_limit,
            emotion_snapshot=emotion_snapshot,
            is_proactive_checkin=is_proactive_checkin,
        )
        prompt = self._prepend_turn_policy(prompt)

        sources = [
            AssistantSource(
                type=item.type,
                id=item.id,
                title=item.title,
                source=item.source,
                score=item.score,
            )
            for item in final_contexts
        ]

        # Check if active tools are available for surface
        active_tools = self.tool_router.get_openai_tools(resolved_request.surface)
        supports_tools = self._supports_tools(active_tools)

        full_reply_parts = []
        try:
            if supports_tools:
                initial_gen: LlmGeneration
                async with _LLM_SEMAPHORE:
                    initial_gen = await asyncio.wait_for(
                        self.provider.generate(prompt, resolved_request, tools=active_tools),
                        timeout=max(settings.CHATBOT_LLM_TIMEOUT_MS, 1) / 1000,
                    )
                if hasattr(initial_gen, "tool_calls") and initial_gen.tool_calls:
                    augmented_prompt, stream_cards, stream_tool_results = await self._execute_tools_and_augment_prompt(
                        initial_gen.tool_calls, prompt, request
                    )
                    stream_proposals = self._detect_action_proposals(
                        request, tuple(initial_gen.tool_calls), stream_tool_results
                    )
                    pending_actions.extend(stream_cards)
                    pending_actions.extend(stream_proposals)
                    pending_actions = pending_actions[:3]
                    async with _LLM_SEMAPHORE:
                        async for chunk in self.provider.stream(augmented_prompt, resolved_request):
                            full_reply_parts.append(chunk.content)
                            yield AssistantRespondData(
                                reply=chunk.content,
                                sources=sources if len(full_reply_parts) == 1 else [],
                                suggestedActions=pending_actions if len(full_reply_parts) == 1 else [],
                                cards=stream_cards if len(full_reply_parts) == 1 else [],
                                proposals=stream_proposals if len(full_reply_parts) == 1 else [],
                                model=chunk.model or settings.GROQ_MODEL,
                                provider=chunk.provider or "groq",
                                requestId=request_id,
                                latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                                conversationId=request.conversationId or "default",
                            )
                else:
                    direct_content, direct_proposals = self._extract_proposals_from_llm_reply(initial_gen.content)
                    if not direct_proposals:
                        direct_proposals = self._detect_action_proposals(request, (), [])
                    direct_content = self._sanitize_assistant_reply(direct_content)
                    pending_actions.extend(direct_proposals)
                    pending_actions = pending_actions[:3]
                    # Progressive token chunking to deliver natural typing cadence on non-tool replies
                    words = direct_content.split(" ") if direct_content else []
                    if not words:
                        full_reply_parts.append("")
                        yield AssistantRespondData(
                            reply="",
                            sources=sources,
                            suggestedActions=pending_actions,
                            proposals=direct_proposals,
                            model=initial_gen.model or settings.GROQ_MODEL,
                            provider=initial_gen.provider or "groq",
                            requestId=request_id,
                            latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                            conversationId=request.conversationId or "default",
                        )
                    else:
                        chunk_size = 3
                        first_yield = True
                        for i in range(0, len(words), chunk_size):
                            slice_words = words[i:i + chunk_size]
                            chunk_text = " ".join(slice_words)
                            if i + chunk_size < len(words):
                                chunk_text += " "
                            full_reply_parts.append(chunk_text)
                            yield AssistantRespondData(
                                reply=chunk_text,
                                sources=sources if first_yield else [],
                                suggestedActions=pending_actions if first_yield else [],
                                proposals=direct_proposals if first_yield else [],
                                model=initial_gen.model or settings.GROQ_MODEL,
                                provider=initial_gen.provider or "groq",
                                requestId=request_id,
                                latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                                conversationId=request.conversationId or "default",
                            )
                            first_yield = False
                            await asyncio.sleep(0.015)
            else:
                stream_proposals = self._detect_action_proposals(request, (), [])
                pending_actions.extend(stream_proposals)
                pending_actions = pending_actions[:3]
                async with _LLM_SEMAPHORE:
                    async for chunk in self.provider.stream(prompt, resolved_request):
                        full_reply_parts.append(chunk.content)
                        yield AssistantRespondData(
                            reply=chunk.content,
                            sources=sources if len(full_reply_parts) == 1 else [],
                            suggestedActions=pending_actions if len(full_reply_parts) == 1 else [],
                            proposals=stream_proposals if len(full_reply_parts) == 1 else [],
                            model=chunk.model or settings.GROQ_MODEL,
                            provider=chunk.provider or "groq",
                            requestId=request_id,
                            latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                            conversationId=request.conversationId or "default",
                        )
        except (asyncio.CancelledError, GeneratorExit):
            logger.debug("Assistant stream cancelled or client disconnected mid-stream")
            if full_reply_parts:
                full_reply = "".join(full_reply_parts)
                resolved_intent = request.intent or self._infer_intent(
                    final_contexts,
                    fallback_domains=scope_decision.matched_domains,
                )
                try:
                    await self._after_generation(request, full_reply, sources, resolved_intent)
                except Exception:
                    logger.debug("Failed to persist partial stream after cancellation")
            raise
        except Exception:
            logger.exception("Assistant stream generation failed")
            yield AssistantRespondData(
                type="fallback",
                reply="Hệ thống gặp lỗi khi tạo phản hồi. Bạn thử lại sau nhé.",
                sources=[],
                suggestedActions=[],
                model="error-guard",
                provider="chatbot-service",
                requestId=request_id,
                latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                conversationId=request.conversationId or "default",
            )
            return

        full_reply = "".join(full_reply_parts)
        resolved_intent = request.intent or self._infer_intent(
            final_contexts,
            fallback_domains=scope_decision.matched_domains,
        )
        await self._after_generation(
            request, full_reply, sources, resolved_intent, actions=pending_actions
        )

    def _finalize_stream_data(
        self, 
        data: AssistantRespondData, 
        request_id: str, 
        started_at: float, 
        request: AssistantRespondRequest
    ) -> AssistantRespondData:
        return data.model_copy(
            update={
                "requestId": request_id,
                "latencyMs": round((time.perf_counter() - started_at) * 1000, 2),
                "conversationId": request.conversationId or "default",
            }
        )

    async def _after_generation(
        self, 
        request: AssistantRespondRequest, 
        reply: str, 
        sources: list[AssistantSource], 
        intent: str | None,
        actions: list[Any] | None = None,
    ):
        reply_content = self._sanitize_assistant_reply(reply)
        await self._persist_session_memory(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=intent,
        )
        await self.persist_history.execute(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=intent,
            actions=actions,
        )




class AssistantService:
    """Facade service that delegates assistant response handling to command layer."""

    def __init__(
        self,
        prompt_builder: PromptBuilder | None = None,
        provider: LlmProvider | None = None,
        context_resolver: AssistantContextResolver | None = None,
        scope_guard: AssistantScopeGuard | None = None,
        kafka_producer=None,
        outbox_repo=None,
        tool_router_instance: ToolRouter | None = None,
        tool_dispatcher_instance: ToolDispatcher | None = None,
    ):
        self._respond_command = RespondCommand(
            prompt_builder=prompt_builder,
            provider=provider,
            context_resolver=context_resolver,
            scope_guard=scope_guard,
            kafka_producer=kafka_producer,
            outbox_repo=outbox_repo,
            tool_router_instance=tool_router_instance,
            tool_dispatcher_instance=tool_dispatcher_instance,
        )

    async def respond(self, request: AssistantRespondRequest) -> AssistantRespondData:
        return await self._respond_command.execute(request)




assistant_service = AssistantService()
