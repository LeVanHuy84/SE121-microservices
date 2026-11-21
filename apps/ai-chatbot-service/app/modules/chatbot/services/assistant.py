from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Sequence
from typing import Any
from uuid import uuid4

from app.core.metrics import (
    record_empty_reply,
    record_token_usage,
    record_truncation,
    record_turn_latency,
)
from app.core.settings import settings
from app.modules.chatbot.navigation.policy import NavOutcome
from app.modules.chatbot.navigation.resolver import NavResolver, nav_resolver
from app.modules.chatbot.navigation.telemetry import intent_telemetry
from app.modules.chatbot.repositories.chat_history import (
    NON_SUBSTANTIVE_INTENTS,
    PersistHistoryCommand,
    history_store,
)
from app.modules.chatbot.repositories.user_memory_profile import (
    UserMemoryProfileRepository,
    user_memory_profile_repo,
)
from app.modules.chatbot.schemas import (
    AssistantHistoryItem,
    AssistantRespondData,
    AssistantRespondRequest,
    AssistantSource,
    ProposeAction,
    ShowCardAction,
)
from app.modules.chatbot.services.assistant_support import (
    ActionFenceStreamFilter,
    GuardResult,
    PreparedTurn,
    TurnPreparer,
    ambiguous_scope_response,
    build_crisis_response,
    build_proposal_from_meta_tool,
    community_response,
    dedupe_contexts,
    detect_action_proposals,
    emit_crisis_event,
    extract_cards,
    extract_proposals_from_llm_reply,
    farewell_response,
    finalize_stream_data,
    greeting_response,
    in_domain_unknown_response,
    infer_intent,
    is_follow_up_reference,
    is_general_knowledge_only,
    is_incomplete_sentence,
    is_policy_blocked,
    llm_fallback_generation,
    llm_timeout_generation,
    out_of_scope_response,
    pick_recent_user_anchor,
    prepend_turn_policy,
    privacy_policy_response,
    repair_truncated_text,
    resolve_follow_up_message,
    sanitize_assistant_reply,
    supports_tools,
    truncate_text,
)
from app.modules.chatbot.services.context_resolver import (
    AssistantContextResolver,
    assistant_context_resolver,
)
from app.modules.chatbot.services.emotion_context import (
    EmotionSnapshot,
    emotion_context_service,
)
from app.modules.chatbot.services.fact_extractor import (
    FactExtractorService,
    fact_extractor_service,
)
from app.modules.chatbot.services.guardrails import (
    AssistantScopeGuard,
    CommunityGuard,
    ScopeDecision,
    assistant_community_guard,
    assistant_crisis_guard,
    assistant_scope_guard,
)
from app.modules.chatbot.services.prompt_builder import PromptBuilder
from app.modules.chatbot.tools import (
    ToolDispatcher,
    ToolExecutionContext,
    ToolExecutionResult,
    ToolRouter,
    tool_dispatcher,
    tool_router,
)
from app.providers.base import LlmGeneration, LlmProvider, ToolCallInfo
from app.providers.resilient_provider import (
    STREAM_TRUNCATION_NOTICE,
    get_default_llm_provider,
)

logger = logging.getLogger("uvicorn.error")
EMPTY_REPLY_FALLBACK = (
    "Mình chưa thể trả lời ngay lúc này. Bạn thử diễn đạt lại giúp mình nhé."
)
_LLM_SEMAPHORE = asyncio.Semaphore(max(settings.CHATBOT_MAX_CONCURRENT_LLM, 1))

__all__ = [
    "PreparedTurn",
    "GuardResult",
    "ActionFenceStreamFilter",
    "RespondCommand",
    "AssistantService",
    "assistant_service",
]


class RespondCommand:
    def __init__(
        self,
        prompt_builder: PromptBuilder | None = None,
        provider: LlmProvider | None = None,
        context_resolver: AssistantContextResolver | None = None,
        scope_guard: AssistantScopeGuard | None = None,
        community_guard: CommunityGuard | None = None,
        memory=None,
        persist_history: PersistHistoryCommand | None = None,
        kafka_producer=None,
        outbox_repo=None,
        nav_resolver_instance: NavResolver | None = None,
        tool_router_instance: ToolRouter | None = None,
        tool_dispatcher_instance: ToolDispatcher | None = None,
        history_store_instance=None,
        profile_repo: UserMemoryProfileRepository | None = None,
        fact_extractor: FactExtractorService | None = None,
    ):
        self.prompt_builder = prompt_builder or PromptBuilder()
        self.provider = provider or get_default_llm_provider()
        self.context_resolver = context_resolver or assistant_context_resolver
        self.scope_guard = scope_guard or assistant_scope_guard
        self.community_guard = community_guard or assistant_community_guard
        self.crisis_guard = assistant_crisis_guard
        self.emotion_ctx = emotion_context_service
        self.history_store = history_store_instance or history_store
        self.profile_repo = profile_repo or user_memory_profile_repo
        self.fact_extractor = fact_extractor or fact_extractor_service
        self.persist_history = persist_history or PersistHistoryCommand(
            store=self.history_store
        )
        self.nav_resolver = nav_resolver_instance or nav_resolver
        self.tool_router = tool_router_instance or tool_router
        self.dispatcher = tool_dispatcher_instance or tool_dispatcher
        self._kafka_producer = kafka_producer
        self._outbox_repo = outbox_repo
        self._turn_preparer = TurnPreparer(self)

    async def _prepare_turn(
        self,
        request: AssistantRespondRequest,
        started_at: float,
        request_id: str,
    ) -> PreparedTurn:
        return await self._turn_preparer.prepare_turn(request, started_at, request_id)

    async def _run_guard_chain(
        self,
        working_request: AssistantRespondRequest,
        history: list[AssistantHistoryItem],
        last_intent: str | None,
        has_follow_up_anchor: bool,
        emotion_snapshot: EmotionSnapshot,
    ) -> GuardResult:
        turn = await self._prepare_turn(
            working_request, time.perf_counter(), str(uuid4())
        )
        if turn.guard_data:
            return GuardResult(data=turn.guard_data, intent=turn.guard_intent)
        return GuardResult(
            scope_decision=turn.scope_decision,
            contexts=turn.final_contexts,
            pending_actions=turn.pending_actions,
        )

    def _track_nav_offer(
        self, request: AssistantRespondRequest, nav: NavOutcome
    ) -> None:
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
        return is_general_knowledge_only(scope_decision)

    async def execute(self, request: AssistantRespondRequest) -> AssistantRespondData:
        started_at = time.perf_counter()
        request_id = str(uuid4())

        turn = await self._prepare_turn(request, started_at, request_id)
        if turn.guard_data:
            persisted = await self.persist_history.execute(
                request=turn.working_request,
                assistant_reply=turn.guard_data.reply,
                sources=[],
                intent=turn.guard_intent,
                actions=turn.guard_data.suggestedActions,
                policy_blocked=bool(turn.guard_data.policyBlocked),
            )
            return turn.guard_data.model_copy(
                update={
                    "requestId": request_id,
                    "latencyMs": round((time.perf_counter() - started_at) * 1000, 2),
                    "persisted": bool(persisted),
                    "conversationId": turn.conv_id,
                }
            )

        llm_timeout_ms = settings.CHATBOT_LLM_TIMEOUT_MS
        generation: LlmGeneration
        try:
            async with _LLM_SEMAPHORE:
                if turn.supports_tools:
                    generation = await asyncio.wait_for(
                        self.provider.generate(
                            turn.messages_or_prompt,
                            turn.working_request,
                            tools=turn.active_tools,
                        ),
                        timeout=max(llm_timeout_ms, 1) / 1000,
                    )
                else:
                    generation = await asyncio.wait_for(
                        self.provider.generate(
                            turn.messages_or_prompt, turn.working_request
                        ),
                        timeout=max(llm_timeout_ms, 1) / 1000,
                    )
        except asyncio.TimeoutError:
            generation = self._llm_timeout_generation()
        except Exception as exc:
            logger.exception(
                "Assistant generation failed: userId=%s conversationId=%s contexts=%s exc=%s",
                request.userId,
                request.conversationId,
                len(turn.final_contexts),
                exc,
            )
            generation = self._llm_fallback_generation()

        generated_cards: list[ShowCardAction] = []
        tool_results_list: list[Any] = []
        tool_calls_tuple: tuple[Any, ...] = ()
        pending_actions = list(turn.pending_actions)

        # If LLM requested tool calling, execute in parallel and synthesize in second pass
        if hasattr(generation, "tool_calls") and generation.tool_calls:
            tool_calls_tuple = tuple(generation.tool_calls)
            (
                followup_input,
                generated_cards,
                tool_results_list,
            ) = await self._build_tool_followup(
                turn.messages_or_prompt, generation.tool_calls, turn.working_request
            )
            pending_actions.extend(generated_cards)
            try:
                async with _LLM_SEMAPHORE:
                    generation = await asyncio.wait_for(
                        self.provider.generate(followup_input, turn.working_request),
                        timeout=max(llm_timeout_ms, 1) / 1000,
                    )
            except asyncio.TimeoutError:
                generation = self._llm_timeout_generation()
            except Exception as exc:
                logger.exception("Assistant tool synthesis generation failed: %s", exc)
                generation = self._llm_fallback_generation()

        # Synthesize write action proposals (Zero Silent Mutation, guarded by aiPolicy)
        ai_policy = str(
            getattr(turn.working_request, "aiPolicy", "RESTRICTED") or "RESTRICTED"
        ).upper()
        native_tool_proposals = [
            res.proposal
            for res in tool_results_list
            if getattr(res, "proposal", None) is not None
        ]
        cleaned_reply, reply_proposals = self._extract_proposals_from_llm_reply(
            generation.content,
            ai_policy=ai_policy,
            user_id=request.userId,
            conversation_id=turn.conv_id,
        )
        if native_tool_proposals:
            reply_proposals = native_tool_proposals
        elif not reply_proposals:
            reply_proposals = self._detect_action_proposals(
                turn.working_request,
                tool_calls_tuple,
                tool_results_list,
                conversation_id=turn.conv_id,
            )

        generated_proposals = reply_proposals[:3]
        pending_actions.extend(generated_proposals)
        pending_actions = pending_actions[:3]

        reply_content = self._sanitize_assistant_reply(cleaned_reply)
        finish_reason = getattr(generation, "finish_reason", None)
        if finish_reason == "length" or (
            finish_reason is None and is_incomplete_sentence(reply_content)
        ):
            active_reason = finish_reason or "length"
            logger.warning(
                "Assistant reply was truncated (finish_reason=%s); repairing sentence boundary.",
                active_reason,
            )
            reply_content = repair_truncated_text(reply_content)
            record_truncation(active_reason)

        record_token_usage(
            getattr(generation, "prompt_tokens", 0) or 0,
            getattr(generation, "completion_tokens", 0) or 0,
        )

        empty_reply_guarded = not reply_content.strip()
        if empty_reply_guarded:
            logger.warning(
                "Assistant produced an empty reply; using safe fallback (model=%s)",
                generation.model,
            )
            reply_content = EMPTY_REPLY_FALLBACK
            record_empty_reply()
        resolved_intent = request.intent or self._infer_intent(
            turn.final_contexts,
            fallback_domains=turn.scope_decision.matched_domains,
        )
        is_blocked = self._is_policy_blocked(request, reply_content, generation.content)
        persisted = await self.persist_history.execute(
            request=turn.working_request,
            assistant_reply=reply_content,
            sources=turn.sources,
            intent=resolved_intent,
            actions=pending_actions,
            policy_blocked=is_blocked,
            session_emotional_state=turn.session_emotional_state,
        )

        if (
            not is_blocked
            and resolved_intent not in NON_SUBSTANTIVE_INTENTS
            and turn.conv_id
        ):
            self.fact_extractor.maybe_schedule_extraction(
                user_id=request.userId,
                conversation_id=turn.conv_id,
                user_message=request.message,
                turn_count=persisted.turn_count,
                locked_anchor_this_turn=persisted.locked_anchor_this_turn,
                intent=resolved_intent,
                policy_blocked=is_blocked,
            )

        is_fallback_turn = empty_reply_guarded or generation.model in (
            "timeout-guard",
            "fallback-guard",
        )

        record_turn_latency(
            time.perf_counter() - started_at,
            scenario="fallback" if is_fallback_turn else "answer",
        )

        return AssistantRespondData(
            type=(
                turn.guard_intent
                if not is_fallback_turn
                and turn.guard_intent in {"clarify", "no_answer", "out_of_scope"}
                else ("fallback" if is_fallback_turn else "answer")
            ),
            reply=reply_content,
            sources=turn.sources if not is_fallback_turn else [],
            suggestedActions=pending_actions if not is_fallback_turn else [],
            cards=generated_cards if not is_fallback_turn else [],
            proposals=generated_proposals if not is_fallback_turn else [],
            model=generation.model or settings.GROQ_MODEL,
            provider=generation.provider or "groq",
            intent=resolved_intent,
            policyBlocked=is_blocked,
            requestId=request_id,
            latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
            persisted=bool(persisted),
            conversationId=turn.conv_id,
        )

    def _supports_tools(self, active_tools: list[dict[str, Any]]) -> bool:
        return supports_tools(self.provider, active_tools)

    def _extract_cards(
        self,
        tool_calls: tuple[Any, ...],
        tool_results: list[Any],
        user_message: str = "",
    ) -> list[ShowCardAction]:
        return extract_cards(tool_calls, tool_results, user_message=user_message)

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
            ai_policy=str(
                getattr(request, "aiPolicy", "RESTRICTED") or "RESTRICTED"
            ).upper(),
        )
        # Execute tool calls concurrently for optimal latency.
        # Intercept native `propose_account_action` meta-tool without mutating state.
        async def _run_tool(tc: Any) -> ToolExecutionResult:
            if getattr(tc, "name", "") == "propose_account_action":
                proposal, feedback = build_proposal_from_meta_tool(
                    getattr(tc, "args", None) or getattr(tc, "arguments", None),
                    ai_policy=exec_ctx.ai_policy,
                    user_id=request.userId,
                    conversation_id=request.conversationId or "",
                )
                return ToolExecutionResult(
                    tool_name="propose_account_action",
                    success=proposal is not None,
                    data={"proposed": proposal is not None, "message": feedback},
                    error=None if proposal is not None else feedback,
                    proposal=proposal,
                )
            return await self.dispatcher.dispatch(tc.name, tc.args, exec_ctx)

        tool_results = await asyncio.gather(*(_run_tool(tc) for tc in tool_calls))
        tool_results_list = list(tool_results)
        cards = self._extract_cards(
            tool_calls, tool_results_list, user_message=request.message
        )
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

    async def _build_tool_followup(
        self,
        messages_or_prompt: Any,
        tool_calls: Sequence[Any],
        request: AssistantRespondRequest,
    ) -> tuple[Any, list[ShowCardAction], list[Any]]:
        (
            augmented_prompt,
            cards,
            tool_results,
        ) = await self._execute_tools_and_augment_prompt(
            tuple(tool_calls),
            messages_or_prompt if isinstance(messages_or_prompt, str) else "",
            request,
        )
        if isinstance(messages_or_prompt, list):
            try:
                from langchain_core.messages import AIMessage, ToolMessage
            except ImportError:
                return augmented_prompt, cards, tool_results

            followup_messages = list(messages_or_prompt)
            tc_payload = []
            for i, tc in enumerate(tool_calls):
                tc_id = getattr(tc, "id", None) or f"call_{i}"
                tc_name = getattr(tc, "name", "")
                tc_args = getattr(tc, "args", {}) or getattr(tc, "arguments", {}) or {}
                tc_payload.append({"id": tc_id, "name": tc_name, "args": tc_args})
            followup_messages.append(AIMessage(content="", tool_calls=tc_payload))
            for i, (tc, res) in enumerate(zip(tool_calls, tool_results)):
                tc_id = getattr(tc, "id", None) or f"call_{i}"
                res_content = (
                    res.to_tool_message_content()
                    if hasattr(res, "to_tool_message_content")
                    else str(getattr(res, "data", res))
                )
                followup_messages.append(
                    ToolMessage(content=res_content, tool_call_id=tc_id)
                )
            return followup_messages, cards, tool_results
        return augmented_prompt, cards, tool_results

    def _extract_proposals_from_llm_reply(
        self,
        reply: str,
        ai_policy: str = "RESTRICTED",
        *,
        user_id: str = "",
        conversation_id: str = "",
    ) -> tuple[str, list[ProposeAction]]:
        return extract_proposals_from_llm_reply(
            reply,
            ai_policy,
            user_id=user_id,
            conversation_id=conversation_id,
        )

    def _detect_action_proposals(
        self,
        request: AssistantRespondRequest,
        tool_calls: tuple[Any, ...],
        tool_results: list[Any],
        *,
        conversation_id: str | None = None,
    ) -> list[ProposeAction]:
        return detect_action_proposals(
            request,
            tool_calls,
            tool_results,
            conversation_id=conversation_id,
        )

    async def _resolve_contexts_with_budget(
        self,
        request: AssistantRespondRequest,
        timeout_ms: int,
        emotion_snapshot: EmotionSnapshot | None = None,
        matched_domains: tuple[str, ...] = (),
        distress_level: str = "none",
        topic_anchor: str | None = None,
    ):
        timeout_seconds = max(timeout_ms, 1) / 1000
        try:
            try:
                coro = self.context_resolver.resolve(
                    request,
                    emotion_snapshot,
                    matched_domains=matched_domains,
                    distress_level=distress_level,
                    topic_anchor=topic_anchor,
                )
            except TypeError:
                coro = self.context_resolver.resolve(
                    request,
                    emotion_snapshot,
                    matched_domains=matched_domains,
                )
            return await asyncio.wait_for(
                coro,
                timeout=timeout_seconds,
            )
        except Exception:
            return self._dedupe_contexts(request.contexts)

    def _infer_intent(
        self,
        contexts,
        fallback_domains: tuple[str, ...] = (),
    ) -> str | None:
        return infer_intent(contexts, fallback_domains)

    def _truncate_text(self, value: str, limit: int) -> str:
        return truncate_text(value, limit)

    def _dedupe_contexts(self, contexts):
        return dedupe_contexts(contexts)

    def _llm_timeout_generation(self) -> LlmGeneration:
        return llm_timeout_generation()

    def _llm_fallback_generation(
        self, content: str = EMPTY_REPLY_FALLBACK
    ) -> LlmGeneration:
        return llm_fallback_generation(content=content)

    def _sanitize_assistant_reply(self, value: str) -> str:
        return sanitize_assistant_reply(value)

    def _prepend_turn_policy(self, prompt: str) -> str:
        return prepend_turn_policy(prompt)

    async def _resolve_follow_up_message(
        self,
        message: str,
        history: list[AssistantHistoryItem],
        request: AssistantRespondRequest,
        memory_facts: dict[str, str] | None = None,
    ) -> tuple[str, bool]:
        return await resolve_follow_up_message(
            message, history, request, self.scope_guard, memory_facts
        )

    def _pick_recent_user_anchor(
        self,
        history: list[AssistantHistoryItem],
    ) -> str:
        return pick_recent_user_anchor(history, self.scope_guard)

    def _is_follow_up_reference(self, normalized_message: str) -> bool:
        return is_follow_up_reference(normalized_message)

    def _in_domain_unknown_response(
        self,
        matched_domains: tuple[str, ...],
    ) -> AssistantRespondData:
        return in_domain_unknown_response(matched_domains)

    def _privacy_policy_response(self) -> AssistantRespondData:
        return privacy_policy_response()

    def _out_of_scope_response(self) -> AssistantRespondData:
        return out_of_scope_response()

    def _greeting_response(self) -> AssistantRespondData:
        return greeting_response()

    def _farewell_response(self) -> AssistantRespondData:
        return farewell_response()

    def _ambiguous_scope_response(
        self, matched_domains: tuple[str, ...]
    ) -> AssistantRespondData:
        return ambiguous_scope_response(matched_domains)

    def _community_response(self, reason: str) -> AssistantRespondData:
        return community_response(reason)

    def _build_crisis_response(
        self,
        reply: str,
        severity: str,
        notification_sent: bool,
    ) -> AssistantRespondData:
        return build_crisis_response(reply, severity, notification_sent)

    async def _emit_crisis_event(
        self,
        request: AssistantRespondRequest,
        severity: str,
        rule: str,
        conversation_id: str | None = None,
    ) -> bool:
        return await emit_crisis_event(
            request=request,
            severity=severity,
            rule=rule,
            conversation_id=conversation_id,
            kafka_producer=self._kafka_producer,
            outbox_repo=self._outbox_repo,
        )

    async def execute_stream(
        self, request: AssistantRespondRequest
    ) -> AsyncIterator[AssistantRespondData]:
        started_at = time.perf_counter()
        request_id = str(uuid4())

        turn = await self._prepare_turn(request, started_at, request_id)
        if turn.guard_data:
            await self._after_generation(
                request,
                turn.guard_data.reply,
                [],
                turn.guard_intent,
                actions=turn.guard_data.suggestedActions,
                policy_blocked=bool(turn.guard_data.policyBlocked),
                conv_id=turn.conv_id,
            )
            final_data = self._finalize_stream_data(
                turn.guard_data, request_id, started_at, request, conv_id=turn.conv_id
            )
            yield final_data
            return

        ai_policy = str(
            getattr(turn.working_request, "aiPolicy", "RESTRICTED") or "RESTRICTED"
        ).upper()
        pending_actions = list(turn.pending_actions)
        sources = turn.sources
        stream_cards: list[ShowCardAction] = []
        stream_proposals: list[ProposeAction] = []
        full_reply_parts: list[str] = []

        try:
            tools_for_stream = turn.active_tools if turn.supports_tools else None
            first_yield = True
            collected_tool_calls: list[ToolCallInfo] = []
            filter_stream = ActionFenceStreamFilter()

            def _call_stream(
                input_data: Any, req: AssistantRespondRequest, tools_arg: Any = None
            ):
                if tools_arg is not None:
                    try:
                        return self.provider.stream(input_data, req, tools=tools_arg)
                    except TypeError:
                        return self.provider.stream(input_data, req)
                return self.provider.stream(input_data, req)

            async with _LLM_SEMAPHORE:
                async for chunk in _call_stream(
                    turn.messages_or_prompt,
                    turn.working_request,
                    tools_for_stream,
                ):
                    if chunk.tool_calls:
                        collected_tool_calls.extend(chunk.tool_calls)
                    if chunk.content:
                        full_reply_parts.append(chunk.content)
                        filtered_text = filter_stream.process_chunk(chunk.content)
                        if filtered_text:
                            yield AssistantRespondData(
                                reply=filtered_text,
                                sources=sources if first_yield else [],
                                suggestedActions=pending_actions if first_yield else [],
                                cards=stream_cards if first_yield else [],
                                proposals=stream_proposals if first_yield else [],
                                model=chunk.model or settings.GROQ_MODEL,
                                provider=chunk.provider or "groq",
                                requestId=request_id,
                                latencyMs=round(
                                    (time.perf_counter() - started_at) * 1000, 2
                                ),
                                conversationId=turn.conv_id,
                            )
                            first_yield = False

            # If tool calls were accumulated, execute second pass synthesis
            post_tool_metadata_emitted = False
            if collected_tool_calls:
                (
                    followup_input,
                    stream_cards,
                    stream_tool_results,
                ) = await self._build_tool_followup(
                    turn.messages_or_prompt, collected_tool_calls, turn.working_request
                )
                native_stream_proposals = [
                    res.proposal
                    for res in stream_tool_results
                    if getattr(res, "proposal", None) is not None
                ]
                stream_proposals = (
                    native_stream_proposals
                    if native_stream_proposals
                    else self._detect_action_proposals(
                        turn.working_request,
                        tuple(collected_tool_calls),
                        stream_tool_results,
                        conversation_id=turn.conv_id,
                    )
                )
                pending_actions.extend(stream_cards)
                pending_actions.extend(stream_proposals)
                pending_actions = pending_actions[:3]

                post_tool_reply_parts: list[str] = []
                async with _LLM_SEMAPHORE:
                    async for chunk in self.provider.stream(
                        followup_input, turn.working_request
                    ):
                        if chunk.content:
                            full_reply_parts.append(chunk.content)
                            post_tool_reply_parts.append(chunk.content)
                            filtered_text = filter_stream.process_chunk(chunk.content)
                            if filtered_text:
                                emit_meta = (
                                    first_yield or not post_tool_metadata_emitted
                                )
                                yield AssistantRespondData(
                                    reply=filtered_text,
                                    sources=sources if first_yield else [],
                                    suggestedActions=pending_actions
                                    if emit_meta
                                    else [],
                                    cards=stream_cards if emit_meta else [],
                                    proposals=stream_proposals if emit_meta else [],
                                    model=chunk.model or settings.GROQ_MODEL,
                                    provider=chunk.provider or "groq",
                                    requestId=request_id,
                                    latencyMs=round(
                                        (time.perf_counter() - started_at) * 1000, 2
                                    ),
                                    conversationId=turn.conv_id,
                                )
                                first_yield = False
                                post_tool_metadata_emitted = True

                if not stream_proposals and post_tool_reply_parts:
                    _, extracted_post_proposals = (
                        self._extract_proposals_from_llm_reply(
                            "".join(post_tool_reply_parts),
                            ai_policy=ai_policy,
                            user_id=request.userId,
                            conversation_id=turn.conv_id,
                        )
                    )
                    if extracted_post_proposals:
                        stream_proposals = extracted_post_proposals[:3]
                        pending_actions.extend(stream_proposals)
                        pending_actions = pending_actions[:3]
                        post_tool_metadata_emitted = False
            else:
                raw_text = "".join(full_reply_parts)
                cleaned, proposals = self._extract_proposals_from_llm_reply(
                    raw_text,
                    ai_policy=ai_policy,
                    user_id=request.userId,
                    conversation_id=turn.conv_id,
                )
                if not proposals:
                    proposals = self._detect_action_proposals(
                        turn.working_request,
                        (),
                        [],
                        conversation_id=turn.conv_id,
                    )
                stream_proposals = proposals[:3]
                pending_actions.extend(stream_proposals)
                pending_actions = pending_actions[:3]

            trailing_text = filter_stream.flush()
            if trailing_text:
                emit_meta = (
                    first_yield
                    or (bool(collected_tool_calls) and not post_tool_metadata_emitted)
                    or bool(not collected_tool_calls and stream_proposals)
                )
                trailing_suggested = (
                    pending_actions
                    if (
                        first_yield
                        or (collected_tool_calls and not post_tool_metadata_emitted)
                    )
                    else (stream_proposals if stream_proposals else [])
                )
                yield AssistantRespondData(
                    reply=trailing_text,
                    sources=sources if first_yield else [],
                    suggestedActions=trailing_suggested if emit_meta else [],
                    cards=stream_cards if emit_meta else [],
                    proposals=stream_proposals if emit_meta else [],
                    model=settings.GROQ_MODEL,
                    provider="groq",
                    requestId=request_id,
                    latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                    conversationId=turn.conv_id,
                )
                first_yield = False
                post_tool_metadata_emitted = True
            elif (
                collected_tool_calls
                and not post_tool_metadata_emitted
                and (stream_proposals or stream_cards)
            ) or (not collected_tool_calls and stream_proposals):
                yield AssistantRespondData(
                    reply="",
                    sources=sources if first_yield else [],
                    suggestedActions=(
                        pending_actions
                        if (first_yield or collected_tool_calls)
                        else stream_proposals
                    ),
                    cards=stream_cards,
                    proposals=stream_proposals,
                    model=settings.GROQ_MODEL,
                    provider="groq",
                    requestId=request_id,
                    latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                    conversationId=turn.conv_id,
                )
                first_yield = False

        except (asyncio.CancelledError, GeneratorExit):
            logger.debug("Assistant stream cancelled or client disconnected mid-stream")
            if full_reply_parts:
                full_reply = "".join(full_reply_parts)
                resolved_intent = request.intent or self._infer_intent(
                    turn.final_contexts,
                    fallback_domains=turn.scope_decision.matched_domains,
                )
                try:
                    await self._after_generation(
                        request,
                        full_reply,
                        sources,
                        resolved_intent,
                        conv_id=turn.conv_id,
                    )
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
                conversationId=turn.conv_id,
            )
            return

        full_reply = "".join(full_reply_parts)
        is_blocked = self._is_policy_blocked(request, full_reply)
        if (
            not full_reply.strip()
            and not is_blocked
            and not stream_cards
            and not stream_proposals
        ):
            logger.warning("Assistant stream produced an empty reply; using fallback")
            full_reply = EMPTY_REPLY_FALLBACK
            yield AssistantRespondData(
                type="fallback",
                reply=EMPTY_REPLY_FALLBACK,
                sources=sources if first_yield else [],
                suggestedActions=[],
                model=settings.GROQ_MODEL,
                provider="chatbot-service",
                requestId=request_id,
                latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                conversationId=turn.conv_id,
            )
        resolved_intent = request.intent or self._infer_intent(
            turn.final_contexts,
            fallback_domains=turn.scope_decision.matched_domains,
        )
        await self._after_generation(
            request,
            full_reply,
            sources,
            resolved_intent,
            actions=pending_actions,
            policy_blocked=is_blocked,
            conv_id=turn.conv_id,
            session_emotional_state=turn.session_emotional_state,
        )
        if is_blocked:
            yield AssistantRespondData(
                type="answer",
                reply="",
                sources=[],
                suggestedActions=[],
                model=settings.GROQ_MODEL,
                provider="chatbot-service",
                requestId=request_id,
                latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                conversationId=turn.conv_id,
                policyBlocked=True,
            )

    def _finalize_stream_data(
        self,
        data: AssistantRespondData,
        request_id: str,
        started_at: float,
        request: AssistantRespondRequest,
        conv_id: str | None = None,
    ) -> AssistantRespondData:
        return finalize_stream_data(data, request_id, started_at, request, conv_id)

    def _is_policy_blocked(
        self,
        request: AssistantRespondRequest,
        reply_content: str,
        raw_llm_reply: str = "",
    ) -> bool:
        return is_policy_blocked(request, reply_content, raw_llm_reply)

    async def _after_generation(
        self,
        request: AssistantRespondRequest,
        reply: str,
        sources: list[AssistantSource],
        intent: str | None,
        actions: list[Any] | None = None,
        policy_blocked: bool = False,
        conv_id: str | None = None,
        session_emotional_state: dict[str, Any] | None = None,
    ):
        resolved_conv_id = conv_id or request.conversationId
        is_truncated = STREAM_TRUNCATION_NOTICE.strip() in reply
        cleaned_reply = reply.replace(STREAM_TRUNCATION_NOTICE, "").strip()
        reply_content = self._sanitize_assistant_reply(cleaned_reply)
        req_with_conv = (
            request
            if request.conversationId == resolved_conv_id
            else request.model_copy(update={"conversationId": resolved_conv_id})
        )
        persisted = await self.persist_history.execute(
            request=req_with_conv,
            assistant_reply=reply_content,
            sources=sources,
            intent=intent,
            actions=actions,
            policy_blocked=policy_blocked,
            session_emotional_state=session_emotional_state,
        )
        if (
            not is_truncated
            and not policy_blocked
            and intent not in NON_SUBSTANTIVE_INTENTS
            and resolved_conv_id
        ):
            self.fact_extractor.maybe_schedule_extraction(
                user_id=request.userId,
                conversation_id=resolved_conv_id,
                user_message=request.message,
                turn_count=persisted.turn_count,
                locked_anchor_this_turn=persisted.locked_anchor_this_turn,
                intent=intent,
                policy_blocked=policy_blocked,
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
        history_store_instance=None,
        profile_repo: UserMemoryProfileRepository | None = None,
        fact_extractor: FactExtractorService | None = None,
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
            history_store_instance=history_store_instance,
            profile_repo=profile_repo,
            fact_extractor=fact_extractor,
        )

    async def respond(self, request: AssistantRespondRequest) -> AssistantRespondData:
        return await self._respond_command.execute(request)


assistant_service = AssistantService()
