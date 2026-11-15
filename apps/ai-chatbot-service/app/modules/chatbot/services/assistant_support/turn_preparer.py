from __future__ import annotations

import asyncio
from typing import Any

from app.core.settings import settings
from app.modules.chatbot.navigation.policy import build_nav_outcome
from app.modules.chatbot.schemas import (
    AssistantRespondRequest,
    AssistantSource,
)
from app.modules.chatbot.services.assistant_support.proposals import (
    is_explicit_action_request,
)
from app.modules.chatbot.services.assistant_support.types import PreparedTurn
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.guardrails import (
    GREETINGS,
    ScopeDecision,
    classify_in_chat_distress_level,
    has_in_chat_emotional_distress,
    stage2_guard_verifier,
)
from app.modules.chatbot.services.prompt_limits import resolve_prompt_limits
from app.utils.text_normalizer import normalize_for_guard

SHORT_FOLLOWUP_MAX_TOKENS = 12
_EXPLICIT_RECOVERY_CUES = (
    "minh on roi",
    "toi on roi",
    "do hon roi",
    "het lo roi",
    "on hon roi",
)
_POLITE_THANKS_CUES = (
    "cam on ban",
    "cam on nhieu",
)
_CONTINUATION_NEGATION_TOKENS = (
    "nhung",
    "van",
    "chua",
    "hoi",
    "met",
    "ngop",
    "kho",
    "lo",
)


def _is_positive_recovery_cue(text: str) -> bool:
    norm = normalize_for_guard(text)
    if any(cue in norm for cue in _EXPLICIT_RECOVERY_CUES):
        return True
    tokens = norm.split()
    if len(tokens) <= 6 and any(cue in norm for cue in _POLITE_THANKS_CUES):
        return not any(tok in _CONTINUATION_NEGATION_TOKENS for tok in tokens)
    return False


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
        prev_emotional_state = dict(conv.get("session_emotional_state") or {})
        prev_active_tier = str(prev_emotional_state.get("active_tier") or "NONE")
        prev_ttl = int(prev_emotional_state.get("remaining_turns_ttl") or 0)
        prev_topic_anchor = str(prev_emotional_state.get("topic_anchor") or "")
        ai_policy = str(getattr(request, "aiPolicy", "RESTRICTED") or "RESTRICTED").upper()
        is_restricted = ai_policy == "RESTRICTED"
        request_updates: dict[str, Any] = {"conversationId": conv_id}
        if is_restricted and request.contexts:
            request_updates["contexts"] = []
        request = request.model_copy(update=request_updates)

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
                in_chat_distress=False,
                is_system_turn=False,
                guard_data=data,
                guard_intent="mental_health_crisis",
            )

        community_decision = cmd.community_guard.evaluate(request.message)
        if (
            not community_decision.allowed
            and community_decision.reason != "profanity_candidate"
        ):
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
                in_chat_distress=False,
                is_system_turn=False,
                guard_data=data,
                guard_intent="community_guard",
            )

        nav = build_nav_outcome(
            None
            if is_explicit_action_request(request.message)
            else cmd.nav_resolver.resolve(request.message, ai_policy=ai_policy),
            ai_policy=ai_policy,
        )
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

        if is_restricted:
            history_res = await _load_history()
            user_facts = {}
            emotion_snapshot = EmotionSnapshot()
        else:
            history_res, user_facts, emotion_snapshot = await asyncio.gather(
                _load_history(),
                cmd.profile_repo.get_facts_by_user(request.userId),
                cmd.emotion_ctx.get_snapshot(request.userId),
            )
        history, db_last_intent, _ = history_res
        last_intent = request.intent or db_last_intent

        # Greeting check
        normalized_msg = cmd.scope_guard._normalize(request.message)
        if normalized_msg in GREETINGS:
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
                    in_chat_distress=False,
                    is_system_turn=False,
                    guard_data=data,
                    guard_intent="mental_health_crisis",
                )

        # Step 4: Stage 1 ScopeGuard (Pre-RAG) & Conditional Stage 2 Hybrid Guard
        scope_decision = cmd.scope_guard.evaluate_scope(
            working_request,
            last_intent=last_intent,
            recent_history=history,
        )
        distress_level = classify_in_chat_distress_level(working_request.message)
        is_short_followup = (
            len(working_request.message.split()) <= SHORT_FOLLOWUP_MAX_TOKENS
        )
        is_system_turn = self._compute_is_system_turn(scope_decision.matched_domains)
        has_active_session_anchor = (
            not is_system_turn
            and prev_ttl > 0
            and prev_active_tier in {"TIER_2_PFA", "TIER_3_CBT"}
            and bool(prev_topic_anchor)
            and is_short_followup
            and not _is_positive_recovery_cue(working_request.message)
        )
        effective_query = (
            f"{prev_topic_anchor} {working_request.message}".strip()
            if has_active_session_anchor
            else working_request.message
        )

        needs_stage2 = (
            community_decision.reason == "profanity_candidate"
            or (not scope_decision.in_scope and scope_decision.reason != "privacy")
            or (0.15 < scope_decision.confidence < 0.45)
            or distress_level != "none"
        )
        if needs_stage2:
            stage2_res = None
            try:
                stage2_res = await asyncio.wait_for(
                    stage2_guard_verifier.verify_async(
                        working_request.message,
                        stage1_scope=scope_decision,
                        stage1_community=community_decision,
                        stage1_crisis=crisis_decision,
                        topic_anchor=prev_topic_anchor
                        if has_active_session_anchor
                        else None,
                        effective_query=effective_query,
                    ),
                    timeout=0.25,
                )
            except TimeoutError:
                stage2_res = None

            if (
                stage2_res is not None
                and stage2_res.crisis_decision_override is not None
                and stage2_res.crisis_decision_override.is_crisis
            ):
                c_over = stage2_res.crisis_decision_override
                notification_sent = await cmd._emit_crisis_event(
                    working_request,
                    c_over.severity,
                    c_over.reason,
                    conversation_id=conv_id,
                )
                reply = cmd.prompt_builder.build_crisis(
                    severity=c_over.severity,
                    notification_sent=notification_sent,
                )
                data = cmd._build_crisis_response(
                    reply,
                    c_over.severity,
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
                    in_chat_distress=True,
                    is_system_turn=False,
                    guard_data=data,
                    guard_intent="mental_health_crisis",
                    distress_level="acute_pfa",
                )

            if community_decision.reason == "profanity_candidate":
                if (
                    stage2_res is None
                    or stage2_res.community_allowed_override is not True
                ):
                    data = cmd._community_response("profanity")
                    return PreparedTurn(
                        working_request=working_request,
                        conv_id=conv_id,
                        history=history,
                        user_facts=user_facts or {},
                        emotion_snapshot=emotion_snapshot,
                        scope_decision=ScopeDecision(
                            False, "community", "", "out_of_scope", 0.0, ()
                        ),
                        final_contexts=[],
                        sources=[],
                        active_tools=[],
                        supports_tools=False,
                        pending_actions=[],
                        howto_actions=howto_actions,
                        messages_or_prompt="",
                        in_chat_distress=False,
                        is_system_turn=False,
                        guard_data=data,
                        guard_intent="community_guard",
                    )

            if stage2_res is not None:
                if stage2_res.distress_level == "acute_pfa":
                    distress_level = "acute_pfa"
                elif (
                    stage2_res.distress_level == "mild_cbt" and distress_level == "none"
                ):
                    distress_level = "mild_cbt"

                if stage2_res.in_scope_override is True:
                    scope_decision = ScopeDecision(
                        in_scope=True,
                        reason="stage2_semantic",
                        normalized_text=scope_decision.normalized_text,
                        state="in_scope",
                        confidence=max(scope_decision.confidence, 0.76),
                        matched_domains=stage2_res.matched_domains_override
                        or scope_decision.matched_domains,
                    )
                    is_system_turn = self._compute_is_system_turn(
                        scope_decision.matched_domains
                    )
                    if is_system_turn:
                        has_active_session_anchor = False

        in_chat_distress = distress_level != "none"

        if (
            not scope_decision.in_scope
            and scope_decision.state != "in_domain_unknown"
            and not in_chat_distress
            and not has_active_session_anchor
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
                in_chat_distress=False,
                is_system_turn=is_system_turn,
                guard_data=data,
                guard_intent=intent,
            )

        normalized_msg_lower = (working_request.message or "").lower()
        is_memory_recall_turn = (
            bool(history)
            and len(normalized_msg_lower.split()) <= 18
            and distress_level == "none"
            and not is_system_turn
            and any(
                cue in normalized_msg_lower
                for cue in ("nhớ tên", "còn nhớ", "bạn nhớ", "mình tên", "mình thích")
            )
        )

        # Step 5: Cross-Lingual Hybrid RAG & Stage 2 Grounding Gate
        if working_request.contexts:
            candidate_contexts = cmd._dedupe_contexts(working_request.contexts)
        elif is_memory_recall_turn:
            candidate_contexts = []
        else:
            candidate_contexts = await cmd._resolve_contexts_with_budget(
                working_request,
                settings.CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS,
                emotion_snapshot,
                matched_domains=scope_decision.matched_domains,
                distress_level=distress_level,
                topic_anchor=prev_topic_anchor if has_active_session_anchor else None,
            )
        prompt_limits = resolve_prompt_limits(request.userId)
        max_ctx = prompt_limits.max_context_items
        if (
            not working_request.contexts
            and distress_level == "none"
            and len(normalized_msg_lower.split()) <= 16
        ):
            max_ctx = min(max_ctx, 2)
        final_contexts = candidate_contexts[:max_ctx]
        working_request = working_request.model_copy(
            update={"contexts": final_contexts}
        )

        active_tools = cmd.tool_router.get_openai_tools(
            working_request.surface,
            matched_domains=scope_decision.matched_domains,
            ai_policy=ai_policy,
            is_system_turn=is_system_turn,
        )
        has_tools = bool(active_tools)
        supports_tools = cmd._supports_tools(active_tools)

        if hasattr(cmd.context_resolver, "_is_mental_health_turn"):
            is_mental_health_turn = cmd.context_resolver._is_mental_health_turn(
                working_request.message,
                scope_decision.matched_domains,
                None if is_restricted else emotion_snapshot,
                distress_level=distress_level,
            )
        else:
            is_mental_health_turn = bool(
                has_in_chat_emotional_distress(working_request.message)
                or (set(scope_decision.matched_domains) & {"mental_health", "emotion"})
            )

        # Multi-turn emotional state transition
        if distress_level in {"acute_pfa", "mild_cbt"}:
            active_tier = (
                "TIER_2_PFA" if distress_level == "acute_pfa" else "TIER_3_CBT"
            )
            session_emotional_state = {
                "active_tier": active_tier,
                "remaining_turns_ttl": 3,
                "topic_anchor": working_request.message[:200],
            }
            effective_session_tier = active_tier
        elif is_system_turn and distress_level == "none":
            session_emotional_state = {
                "active_tier": "NONE",
                "remaining_turns_ttl": 0,
                "topic_anchor": "",
            }
            effective_session_tier = "NONE"
        elif not is_system_turn and has_active_session_anchor:
            distress_level = (
                "acute_pfa" if prev_active_tier == "TIER_2_PFA" else "mild_cbt"
            )
            in_chat_distress = True
            next_ttl = max(prev_ttl - 1, 0)
            if next_ttl == 0:
                session_emotional_state = {
                    "active_tier": "NONE",
                    "remaining_turns_ttl": 0,
                    "topic_anchor": "",
                }
            else:
                session_emotional_state = {
                    "active_tier": prev_active_tier,
                    "remaining_turns_ttl": next_ttl,
                    "topic_anchor": prev_topic_anchor,
                }
            effective_session_tier = prev_active_tier
        else:
            session_emotional_state = dict(prev_emotional_state) if prev_ttl > 0 else {
                "active_tier": "NONE",
                "remaining_turns_ttl": 0,
                "topic_anchor": "",
            }
            effective_session_tier = "NONE"

        # Stage 2 Grounding Gate
        if not final_contexts and not is_mental_health_turn and not is_memory_recall_turn:
            if (
                scope_decision.state == "in_domain_unknown"
                or not scope_decision.in_scope
            ):
                data = (
                    cmd._privacy_policy_response()
                    if is_restricted
                    else cmd._in_domain_unknown_response(scope_decision.matched_domains)
                )
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
                    in_chat_distress=in_chat_distress,
                    is_system_turn=is_system_turn,
                    guard_data=data,
                    guard_intent="privacy" if is_restricted else "in_domain_unknown",
                )
            if (
                scope_decision.in_scope
                and not has_tools
                and not has_follow_up_anchor
                and scope_decision.matched_domains
            ):
                data = (
                    cmd._privacy_policy_response()
                    if is_restricted
                    else cmd._in_domain_unknown_response(scope_decision.matched_domains)
                )
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
                    in_chat_distress=in_chat_distress,
                    is_system_turn=is_system_turn,
                    guard_data=data,
                    guard_intent="privacy" if is_restricted else "in_domain_unknown",
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
        if getattr(cmd.provider, "supports_chat_messages", False):
            messages_or_prompt = cmd.prompt_builder.build_messages(
                working_request,
                history,
                memory_summary="",
                user_facts=user_facts,
                context_char_limit=prompt_limits.context_char_limit,
                max_history_items=prompt_limits.max_history_items,
                history_item_char_limit=prompt_limits.history_item_char_limit,
                context_total_char_limit=prompt_limits.context_total_char_limit,
                emotion_snapshot=None if is_restricted else emotion_snapshot,
                in_chat_distress=in_chat_distress,
                is_system_turn=is_system_turn,
                distress_level=distress_level,
                session_active_tier=effective_session_tier,
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
                emotion_snapshot=None if is_restricted else emotion_snapshot,
                in_chat_distress=in_chat_distress,
                is_system_turn=is_system_turn,
                distress_level=distress_level,
                session_active_tier=effective_session_tier,
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
            in_chat_distress=in_chat_distress,
            is_system_turn=is_system_turn,
            distress_level=distress_level,
            session_emotional_state=session_emotional_state,
        )

    def _compute_is_system_turn(self, matched_domains: tuple[str, ...]) -> bool:
        if hasattr(self.cmd.context_resolver, "_is_system_turn"):
            return bool(self.cmd.context_resolver._is_system_turn(matched_domains))
        from app.modules.chatbot.services.context_resolver import (
            SYSTEM_FEATURE_DOMAINS,
        )

        return bool(set(matched_domains) & SYSTEM_FEATURE_DOMAINS)
