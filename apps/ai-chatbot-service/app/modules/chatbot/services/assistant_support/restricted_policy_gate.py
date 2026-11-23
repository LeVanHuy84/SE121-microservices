from __future__ import annotations

from typing import Any

from app.modules.chatbot.navigation.policy import to_action
from app.modules.chatbot.navigation.resolver import (
    READ_TOOL_BACKED_DESTINATIONS,
    _DATA_RETRIEVAL_INDICATORS,
    _HOWTO_INDICATORS,
    _VIEW_DATA_PREFIXES,
)
from app.modules.chatbot.schemas import (
    AssistantRespondData,
    AssistantRespondRequest,
    NavigateAction,
    NavigatePayload,
)
from app.modules.chatbot.services.assistant_support.proposals import (
    is_explicit_action_request,
)
from app.modules.chatbot.services.assistant_support.types import PreparedTurn
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.guardrails import ScopeDecision
from app.utils.text_normalizer import normalize_for_guard


def evaluate_restricted_policy_gate(
    cmd: Any,
    request: AssistantRespondRequest,
    conv_id: str,
) -> PreparedTurn | None:
    """Short-circuit explicit write-action or personal data-retrieval queries under RESTRICTED.

    How-to / feature FAQ queries are always allowed through to APP_GUIDE RAG.
    """
    norm_policy_msg = normalize_for_guard(request.message)
    padded_policy_msg = f" {norm_policy_msg} "
    is_howto_faq = any(ind in norm_policy_msg for ind in _HOWTO_INDICATORS)
    if is_howto_faq:
        return None

    is_action_req = is_explicit_action_request(request.message)
    is_data_query = any(
        f" {ind} " in padded_policy_msg for ind in _DATA_RETRIEVAL_INDICATORS
    ) or any(norm_policy_msg.startswith(p) for p in _VIEW_DATA_PREFIXES)

    # Use score_destinations() directly so _DATA_RETRIEVAL_INDICATORS do not cause
    # nav_resolver.resolve() to short-circuit with matches=[] (fail-open bug).
    top_dest = None
    if is_action_req or is_data_query:
        if hasattr(cmd.nav_resolver, "score_destinations"):
            scored_matches = cmd.nav_resolver.score_destinations(
                request.message, ai_policy="FULL"
            )
            top_dest = scored_matches[0] if scored_matches else None
        else:
            matched_nav = cmd.nav_resolver.resolve(request.message, ai_policy="FULL")
            top_dest = (
                matched_nav.matches[0] if matched_nav and matched_nav.matches else None
            )

    is_personal_data_query = bool(
        is_data_query
        and top_dest is not None
        and top_dest.destination_id in READ_TOOL_BACKED_DESTINATIONS
    )
    if not (is_action_req or is_personal_data_query):
        return None

    privacy_action = NavigateAction(
        label="Cài đặt Quyền riêng tư",
        payload=NavigatePayload(destinationId="settings.privacy"),
    )
    suggested_nav_actions: list[NavigateAction] = [privacy_action]
    if top_dest is not None and top_dest.destination_id != "settings.privacy":
        suggested_nav_actions.append(to_action(top_dest))

    if is_action_req:
        policy_reply = (
            "Tài khoản của bạn hiện đang bật chế độ **Riêng tư tối đa (RESTRICTED)** nên trợ lý AI "
            "không thể đề xuất hoặc thực hiện thao tác tài khoản. "
            "Bạn có thể bật chế độ **Đầy đủ tính năng (FULL)** tại **Cài đặt → Quyền riêng tư** "
            "để sử dụng tính năng này nhé:"
        )
    else:
        policy_reply = (
            "Tài khoản của bạn hiện đang bật chế độ **Riêng tư tối đa (RESTRICTED)** nên trợ lý AI "
            "không có quyền đọc dữ liệu cá nhân của bạn. "
            "Bạn có thể bật chế độ **Đầy đủ tính năng (FULL)** tại **Cài đặt → Quyền riêng tư** "
            "để trợ lý tra cứu trực tiếp, hoặc bấm nút bên dưới để tự xem thủ công nhé:"
        )

    policy_data = AssistantRespondData(
        type="answer",
        reply=policy_reply,
        sources=[],
        suggestedActions=suggested_nav_actions,
        model="policy-guard",
        provider="chatbot-service",
        policyBlocked=True,
    )
    return PreparedTurn(
        working_request=request,
        conv_id=conv_id,
        history=[],
        user_facts={},
        emotion_snapshot=EmotionSnapshot(),
        scope_decision=ScopeDecision(
            True, "policy_restricted", "", "in_scope", 1.0, ("privacy",)
        ),
        final_contexts=[],
        sources=[],
        active_tools=[],
        supports_tools=False,
        pending_actions=suggested_nav_actions,
        howto_actions=[],
        messages_or_prompt="",
        in_chat_distress=False,
        is_system_turn=True,
        guard_data=policy_data,
        guard_intent="policy_restricted",
    )
