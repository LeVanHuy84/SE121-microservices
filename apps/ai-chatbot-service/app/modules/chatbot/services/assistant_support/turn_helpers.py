from __future__ import annotations

import inspect
import re
import time
from typing import Any

from app.modules.chatbot.navigation.policy import NavOutcome
from app.modules.chatbot.navigation.telemetry import intent_telemetry
from app.modules.chatbot.schemas import (
    AssistantContextItem,
    AssistantHistoryItem,
    AssistantRespondData,
    AssistantRespondRequest,
)
from app.modules.chatbot.services.assistant_support.types import GuardResult
from app.modules.chatbot.services.guardrails import ScopeDecision
from app.providers.base import LlmGeneration, LlmProvider

_GENERAL_KNOWLEDGE_DOMAINS = frozenset({"mental_health", "emotion"})


def is_general_knowledge_only(scope_decision: ScopeDecision) -> bool:
    """True if every matched domain is general knowledge (mental_health/emotion).

    Feature questions ("does it have ... feature") are always treated as app-feature questions.
    """
    domains = scope_decision.matched_domains
    if not domains:
        return False
    if scope_decision.reason == "feature_question_in_domain_unknown":
        return False
    return set(domains).issubset(_GENERAL_KNOWLEDGE_DOMAINS)


def track_nav_offer(request: AssistantRespondRequest, nav: NavOutcome) -> None:
    intent_telemetry.track_offer(
        user_id=request.userId,
        actions=nav.offered_actions,
        resolver_path=nav.path,
    )


def continue_to_llm(
    request: AssistantRespondRequest,
    nav: NavOutcome,
    scope_decision: ScopeDecision,
    contexts: list,
) -> GuardResult:
    """The turn goes to RAG + LLM; how-to navigation buttons ride along and are tracked as offered."""
    track_nav_offer(request, nav)
    return GuardResult(
        scope_decision=scope_decision,
        contexts=contexts,
        pending_actions=nav.howto_actions,
    )


def supports_tools(provider: LlmProvider, active_tools: list[dict[str, Any]]) -> bool:
    if not active_tools:
        return False
    try:
        sig = inspect.signature(provider.generate)
        return "tools" in sig.parameters
    except Exception:
        return False


def infer_intent(
    contexts: list[AssistantContextItem],
    fallback_domains: tuple[str, ...] = (),
) -> str | None:
    if not contexts:
        return fallback_domains[0] if fallback_domains else None
    first_type = contexts[0].type
    if first_type in {"post", "group", "user", "help_doc"}:
        return first_type
    return fallback_domains[0] if fallback_domains else None


def truncate_text(value: str, limit: int) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."


def dedupe_contexts(contexts: list[AssistantContextItem]) -> list[AssistantContextItem]:
    result = []
    seen: set[tuple[str, str]] = set()
    for item in contexts:
        key = (item.type, item.id)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def llm_timeout_generation() -> LlmGeneration:
    return LlmGeneration(
        content=(
            "Hệ thống đang chậm hơn bình thường. "
            "Bạn thử gửi câu hỏi ngắn hơn hoặc thử lại sau vài giây."
        ),
        model="timeout-guard",
        provider="chatbot-service",
    )


def sanitize_assistant_reply(value: str) -> str:
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


def prepend_turn_policy(prompt: str) -> str:
    policy = (
        "TURN_POLICY:\n"
        "- User did not greet in this turn.\n"
        "- Start directly with the answer content.\n"
        "- Do not open with greeting words (e.g., xin chao/hello/hi).\n"
    )
    return f"{policy}\n{prompt}"


def is_follow_up_reference(normalized_message: str) -> bool:
    if not normalized_message:
        return False
    patterns = (
        r"\b(no|cai do|cai nay|truoc do|y truoc do|van de truoc do)\b",
        r"\b(giai thich them|noi ro hon|chi tiet hon|tiep theo)\b",
        r"\b(nhu vay|nhu tren|phan do|muc do)\b",
    )
    return any(re.search(pattern, normalized_message) for pattern in patterns)


def pick_recent_user_anchor(
    history: list[AssistantHistoryItem],
    scope_guard: Any,
) -> str:
    for item in reversed(history[-10:]):
        if item.role != "user":
            continue
        content = " ".join(str(item.content or "").split())
        if not content:
            continue
        normalized = scope_guard._normalize(content)
        if normalized in {"hi", "hello", "hey", "xin chao", "chao"}:
            continue
        if len(normalized.split()) <= 2:
            continue
        if is_follow_up_reference(normalized):
            continue
        return truncate_text(content, 220)
    return ""


async def resolve_follow_up_message(
    message: str,
    history: list[AssistantHistoryItem],
    request: AssistantRespondRequest,
    scope_guard: Any,
    memory_facts: dict[str, str] | None = None,
) -> tuple[str, bool]:
    normalized = scope_guard._normalize(message)
    if not is_follow_up_reference(normalized):
        return message, False

    anchor = pick_recent_user_anchor(history, scope_guard)
    if not anchor:
        return message, False

    rewritten = f"{message.strip()} {anchor}"
    return rewritten, True


def finalize_stream_data(
    data: AssistantRespondData,
    request_id: str,
    started_at: float,
    request: AssistantRespondRequest,
    conv_id: str | None = None,
) -> AssistantRespondData:
    is_blocked = is_policy_blocked(request, data.reply or "")
    return data.model_copy(
        update={
            "requestId": request_id,
            "latencyMs": round((time.perf_counter() - started_at) * 1000, 2),
            "conversationId": conv_id or request.conversationId or "default",
            "policyBlocked": is_blocked or (data.policyBlocked is True),
        }
    )


def is_policy_blocked(
    request: AssistantRespondRequest,
    reply_content: str,
    raw_llm_reply: str = "",
) -> bool:
    if not (request.aiPolicy and str(request.aiPolicy).upper() == "RESTRICTED"):
        return False
    if "```action" in raw_llm_reply or "```json:action" in raw_llm_reply:
        return True
    msg_lower = (request.message or "").lower()
    if any(
        kw in msg_lower
        for kw in (
            "kết bạn",
            "thêm bạn",
            "vào nhóm",
            "tham gia nhóm",
            "rời nhóm",
            "đăng bài",
            "tạo bài viết",
            "thông báo của tôi",
            "bạn bè của tôi",
            "nhóm của tôi",
            "hồ sơ của tôi",
        )
    ):
        return True
    lower_reply = reply_content.lower()
    if any(
        kw in lower_reply
        for kw in (
            "riêng tư tối đa",
            "không thể truy cập thông tin cá nhân",
            "không thể thực hiện thao tác",
            "chế độ bảo mật",
        )
    ):
        return True
    return False
