from __future__ import annotations

import asyncio
from typing import Any

from app.core.settings import settings
from app.modules.chatbot.navigation.policy import build_nav_outcome
from app.modules.chatbot.schemas import (
    AssistantRespondRequest,
    AssistantSource,
)
from app.modules.chatbot.services.assistant_support.types import PreparedTurn
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.guardrails import (
    GREETINGS,
    ScopeDecision,
    has_in_chat_emotional_distress,
)
from app.modules.chatbot.services.prompt_limits import resolve_prompt_limits
from app.providers.groq_provider import GroqProvider


class TurnPreparer:
    """Encapsulates the pre-LLM turn safety, loading, navigation, and context-resolution pipeline."""

    def __init__(self, command: Any) -> None:
        self.cmd = command

    async def prepare_turn(
        self,
        request: AssistantRespondRequest,
        started_at: float,
        request_id: str,
    ) -> PreparedTurn:
        cmd = self.cmd

        # Step 1: Pre-State Safety & Navigation Guards (< 50ms)
        conv = await cmd.history_store.resolve_conversation(
            request.userId, request.conversationId
        )
        conv_id = conv["id"]
        request = request.model_copy(update={"conversationId": conv_id})

        crisis_decision = cmd.crisis_guard.evaluate(request.message)
        if crisis_decision.is_crisis:
            notification_sent = await cmd._emit_crisis_event(
                request,
                crisis_decision.severity,
                crisis_decision.reason,
                conversation_id=conv_id,
            )
            reply = cmd.prompt_builder.build_crisis(
                severity=crisis_decision.severity,
                notification_sent=notification_sent,
            )
            data = cmd._build_crisis_response(
                reply,
                crisis_decision.severity,
                notification_sent,
            )
            return PreparedTurn(
                working_request=request,
                conv_id=conv_id,
                history=[],
                user_facts={},
                emotion_snapshot=EmotionSnapshot(),
                scope_decision=ScopeDecision(
                    False, "crisis", "", "out_of_scope", 0.0, ()
                ),
                final_contexts=[],
                sources=[],
                active_tools=[],
                supports_tools=False,
                pending_actions=[],
                howto_actions=[],
                messages_or_prompt="",
                is_proactive_checkin=False,
                in_chat_distress=False,
                is_system_turn=False,
                guard_data=data,
                guard_intent="mental_health_crisis",
            )

        community_decision = cmd.community_guard.evaluate(request.message)
        if not community_decision.allowed:
            data = cmd._community_response(community_decision.reason)
            return PreparedTurn(
                working_request=request,
                conv_id=conv_id,
                history=[],
                user_facts={},
                emotion_snapshot=EmotionSnapshot(),
                scope_decision=ScopeDecision(
                    False, "community", "", "out_of_scope", 0.0, ()
                ),
                final_contexts=[],
                sources=[],
                active_tools=[],
                supports_tools=False,
                pending_actions=[],
                howto_actions=[],
                messages_or_prompt="",
                is_proactive_checkin=False,
                in_chat_distress=False,
                is_system_turn=False,
                guard_data=data,
                guard_intent="community_guard",
            )

        nav = build_nav_outcome(cmd.nav_resolver.resolve(request.message))
        if nav.response is not None:
            cmd._track_nav_offer(request, nav)
            return PreparedTurn(
                working_request=request,
                conv_id=conv_id,
                history=[],
                user_facts={},
                emotion_snapshot=EmotionSnapshot(),
                scope_decision=ScopeDecision(False, "nav", "", "in_scope", 1.0, ()),
                final_contexts=[],
                sources=[],
                active_tools=[],
                supports_tools=False,
                pending_actions=list(nav.offered_actions),
                howto_actions=list(nav.howto_actions),
                messages_or_prompt="",
                is_proactive_checkin=False,
                in_chat_distress=False,
                is_system_turn=False,
                guard_data=nav.response,
                guard_intent=nav.intent,
            )
        howto_actions = list(nav.howto_actions)

        # Step 2: Parallel State Loading (history, user_facts, emotion_snapshot)
        async def _load_history():
            if request.history:
                return (
                    request.history[-settings.CHATBOT_MEMORY_RECENT_ITEMS :],
                    None,
                    None,
                )
            return await cmd.history_store.load_context_window(request.userId, conv_id)

        history_res, user_facts, emotion_snapshot = await asyncio.gather(
            _load_history(),
            cmd.profile_repo.get_facts_by_user(request.userId),
            cmd.emotion_ctx.get_snapshot(request.userId),
        )
        history, db_last_intent, _ = history_res
        last_intent = request.intent or db_last_intent

        # Greeting check: skipped if (not history and needs_proactive_checkin)
        normalized_msg = cmd.scope_guard._normalize(request.message)
        if normalized_msg in GREETINGS:
            if not (
                not history
                and emotion_snapshot
                and emotion_snapshot.needs_proactive_checkin
            ):
                return PreparedTurn(
                    working_request=request,
                    conv_id=conv_id,
                    history=history,
                    user_facts=user_facts or {},
                    emotion_snapshot=emotion_snapshot,
                    scope_decision=ScopeDecision(
                        True, "greeting", normalized_msg, "in_scope", 1.0, ("system",)
                    ),
                    final_contexts=[],
                    sources=[],
                    active_tools=[],
                    supports_tools=False,
                    pending_actions=[],
                    howto_actions=howto_actions,
                    messages_or_prompt="",
                    is_proactive_checkin=False,
                    in_chat_distress=False,
                    is_system_turn=False,
                    guard_data=cmd._greeting_response(),
                    guard_intent="greeting",
                )

        # Step 3: Deterministic Follow-Up Anchor Resolution (< 1ms)
        effective_message, has_follow_up_anchor = await cmd._resolve_follow_up_message(
            request.message,
            history,
            request,
        )
        working_request = (
            request.model_copy(update={"message": effective_message})
            if effective_message != request.message
            else request
        )
        if has_follow_up_anchor:
            crisis_decision = cmd.crisis_guard.evaluate(working_request.message)
            if crisis_decision.is_crisis:
                notification_sent = await cmd._emit_crisis_event(
                    working_request,
                    crisis_decision.severity,
                    crisis_decision.reason,
                    conversation_id=conv_id,
                )
                reply = cmd.prompt_builder.build_crisis(
                    severity=crisis_decision.severity,
                    notification_sent=notification_sent,
                )
                data = cmd._build_crisis_response(
                    reply,
                    crisis_decision.severity,
                    notification_sent,
                )
                return PreparedTurn(
                    working_request=working_request,
                    conv_id=conv_id,
                    history=history,
                    user_facts=user_facts or {},
                    emotion_snapshot=emotion_snapshot,
                    scope_decision=ScopeDecision(
                        False, "crisis", "", "out_of_scope", 0.0, ()
                    ),
                    final_contexts=[],
                    sources=[],
                    active_tools=[],
                    supports_tools=False,
                    pending_actions=[],
                    howto_actions=howto_actions,
                    messages_or_prompt="",
                    is_proactive_checkin=False,
                    in_chat_distress=False,
                    is_system_turn=False,
                    guard_data=data,
                    guard_intent="mental_health_crisis",
                )

        # Step 4: Stage 1 ScopeGuard (Pre-RAG)
        scope_decision = cmd.scope_guard.evaluate_scope(
            working_request,
            last_intent=last_intent,
            recent_history=history,
        )
        in_chat_distress = has_in_chat_emotional_distress(working_request.message)

        if (
            not scope_decision.in_scope
            and scope_decision.state != "in_domain_unknown"
            and not in_chat_distress
            and not request.contexts
        ):
            intent = "out_of_scope"
            if "privacy" in scope_decision.matched_domains:
                data = cmd._privacy_policy_response()
                intent = "privacy"
            elif scope_decision.state == "ambiguous":
                data = cmd._ambiguous_scope_response(scope_decision.matched_domains)
                intent = "clarify"
            else:
                data = cmd._out_of_scope_response()

            return PreparedTurn(
                working_request=working_request,
                conv_id=conv_id,
                history=history,
                user_facts=user_facts or {},
                emotion_snapshot=emotion_snapshot,
                scope_decision=scope_decision,
                final_contexts=[],
                sources=[],
                active_tools=[],
                supports_tools=False,
                pending_actions=[],
                howto_actions=howto_actions,
                messages_or_prompt="",
                is_proactive_checkin=False,
                in_chat_distress=False,
                is_system_turn=False,
                guard_data=data,
                guard_intent=intent,
            )

        # Step 5: Cross-Lingual Hybrid RAG & Stage 2 Grounding Gate
        candidate_contexts = (
            cmd._dedupe_contexts(working_request.contexts)
            if working_request.contexts
            else await cmd._resolve_contexts_with_budget(
                working_request,
                settings.CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS,
                emotion_snapshot,
                matched_domains=scope_decision.matched_domains,
            )
        )
        prompt_limits = resolve_prompt_limits(request.userId)
        final_contexts = candidate_contexts[: prompt_limits.max_context_items]
        working_request = working_request.model_copy(
            update={"contexts": final_contexts}
        )

        active_tools = cmd.tool_router.get_openai_tools(
            working_request.surface,
            ai_policy=getattr(working_request, "aiPolicy", "FULL"),
        )
        has_tools = bool(active_tools)
        supports_tools = cmd._supports_tools(active_tools)

        if hasattr(cmd.context_resolver, "_is_system_turn"):
            is_system_turn = cmd.context_resolver._is_system_turn(
                scope_decision.matched_domains
            )
        else:
            is_system_turn = bool(
                set(scope_decision.matched_domains)
                & {
                    "navigation",
                    "features",
                    "support",
                    "settings",
                    "profile",
                    "account",
                }
            )

        if hasattr(cmd.context_resolver, "_is_mental_health_turn"):
            is_mental_health_turn = cmd.context_resolver._is_mental_health_turn(
                working_request.message,
                scope_decision.matched_domains,
                emotion_snapshot,
            )
        else:
            is_mental_health_turn = bool(
                has_in_chat_emotional_distress(working_request.message)
                or (set(scope_decision.matched_domains) & {"mental_health", "emotion"})
            )
        is_proactive_checkin = bool(
            emotion_snapshot
            and emotion_snapshot.needs_proactive_checkin
            and not history
        )

        # Stage 2 Grounding Gate
        if (
            not final_contexts
            and not is_mental_health_turn
            and not is_proactive_checkin
        ):
            if (
                scope_decision.state == "in_domain_unknown"
                or not scope_decision.in_scope
            ):
                data = cmd._in_domain_unknown_response(scope_decision.matched_domains)
                return PreparedTurn(
                    working_request=working_request,
                    conv_id=conv_id,
                    history=history,
                    user_facts=user_facts or {},
                    emotion_snapshot=emotion_snapshot,
                    scope_decision=scope_decision,
                    final_contexts=[],
                    sources=[],
                    active_tools=active_tools,
                    supports_tools=supports_tools,
                    pending_actions=howto_actions,
                    howto_actions=howto_actions,
                    messages_or_prompt="",
                    is_proactive_checkin=False,
                    in_chat_distress=in_chat_distress,
                    is_system_turn=is_system_turn,
                    guard_data=data,
                    guard_intent="in_domain_unknown",
                )
            if (
                scope_decision.in_scope
                and not has_tools
                and not has_follow_up_anchor
                and scope_decision.matched_domains
            ):
                data = cmd._in_domain_unknown_response(scope_decision.matched_domains)
                return PreparedTurn(
                    working_request=working_request,
                    conv_id=conv_id,
                    history=history,
                    user_facts=user_facts or {},
                    emotion_snapshot=emotion_snapshot,
                    scope_decision=scope_decision,
                    final_contexts=[],
                    sources=[],
                    active_tools=active_tools,
                    supports_tools=supports_tools,
                    pending_actions=howto_actions,
                    howto_actions=howto_actions,
                    messages_or_prompt="",
                    is_proactive_checkin=False,
                    in_chat_distress=in_chat_distress,
                    is_system_turn=is_system_turn,
                    guard_data=data,
                    guard_intent="in_domain_unknown",
                )

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

        # Step 6: Message / Prompt Construction
        if isinstance(cmd.provider, GroqProvider):
            messages_or_prompt = cmd.prompt_builder.build_messages(
                working_request,
                history,
                memory_summary="",
                user_facts=user_facts,
                context_char_limit=prompt_limits.context_char_limit,
                max_history_items=prompt_limits.max_history_items,
                history_item_char_limit=prompt_limits.history_item_char_limit,
                context_total_char_limit=prompt_limits.context_total_char_limit,
                emotion_snapshot=emotion_snapshot,
                is_proactive_checkin=is_proactive_checkin,
                in_chat_distress=in_chat_distress,
                is_system_turn=is_system_turn,
            )
        else:
            prompt_str = cmd.prompt_builder.build(
                working_request,
                history,
                user_facts=user_facts,
                context_char_limit=prompt_limits.context_char_limit,
                max_history_items=prompt_limits.max_history_items,
                history_item_char_limit=prompt_limits.history_item_char_limit,
                context_total_char_limit=prompt_limits.context_total_char_limit,
                emotion_snapshot=emotion_snapshot,
                is_proactive_checkin=is_proactive_checkin,
                in_chat_distress=in_chat_distress,
                is_system_turn=is_system_turn,
            )
            messages_or_prompt = cmd._prepend_turn_policy(prompt_str)

        return PreparedTurn(
            working_request=working_request,
            conv_id=conv_id,
            history=history,
            user_facts=user_facts or {},
            emotion_snapshot=emotion_snapshot,
            scope_decision=scope_decision,
            final_contexts=final_contexts,
            sources=sources,
            active_tools=active_tools,
            supports_tools=supports_tools,
            pending_actions=howto_actions,
            howto_actions=howto_actions,
            messages_or_prompt=messages_or_prompt,
            is_proactive_checkin=is_proactive_checkin,
            in_chat_distress=in_chat_distress,
            is_system_turn=is_system_turn,
        )
