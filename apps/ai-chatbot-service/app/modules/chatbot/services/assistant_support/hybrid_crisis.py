from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from app.core.settings import settings
from app.modules.chatbot.schemas import AssistantRespondRequest
from app.modules.chatbot.services.assistant_support.turn_helpers import (
    sanitize_assistant_reply,
)
from app.modules.chatbot.services.prompt_builder import CRISIS_RESOURCES

logger = logging.getLogger("uvicorn.error")

HYBRID_CRISIS_TIMEOUT_SECONDS = 2.5
HYBRID_CRISIS_MIN_CHARS = 20
HYBRID_CRISIS_MAX_CHARS = 420

_ALLOWED_CRISIS_NUMBERS: frozenset[str] = frozenset(
    re.sub(r"\D", "", phone) for _, phone in CRISIS_RESOURCES
)
_DIGIT_SEQUENCE_RE = re.compile(r"\b\d[\d\s.\-]{2,}\d\b|\b\d{3,}\b")


def _contains_unverified_phone_number(text: str) -> bool:
    for match in _DIGIT_SEQUENCE_RE.findall(text):
        digits = re.sub(r"\D", "", match)
        if len(digits) >= 3 and digits not in _ALLOWED_CRISIS_NUMBERS:
            return True
    return False


async def build_hybrid_crisis_reply(
    cmd: Any,
    request: AssistantRespondRequest,
    *,
    severity: str,
    notification_sent: bool,
    timeout_seconds: float = HYBRID_CRISIS_TIMEOUT_SECONDS,
) -> str:
    """Generate personalized crisis empathy via LLM with strict sanitization, timeout, and static fallback.

    Always falls back to the deterministic static template on timeout, rate-limit, empty/unsafe/oversized
    reply, or in unit-test/stub mode so crisis responses never fail or lose official hotlines.
    """
    static_fallback = cmd.prompt_builder.build_crisis(
        severity=severity,
        notification_sent=notification_sent,
    )
    if (
        settings.UNIT_TEST_MODE
        or settings.CHATBOT_LLM_STUB_MODE
        or getattr(cmd, "provider", None) is None
        or not hasattr(cmd.prompt_builder, "build_crisis_empathy_messages")
    ):
        return static_fallback

    messages = cmd.prompt_builder.build_crisis_empathy_messages(
        request.message,
        severity=severity,
    )
    prompt_input: Any = (
        messages
        if getattr(cmd.provider, "supports_chat_messages", False)
        else f"{messages[0]['content']}\n\nNgười dùng: {messages[1]['content']}"
    )
    try:
        generation = await asyncio.wait_for(
            cmd.provider.generate(prompt_input, request),
            timeout=timeout_seconds,
        )
        raw_intro = str(getattr(generation, "content", "") or "").strip()
        empathy_intro = sanitize_assistant_reply(raw_intro).strip()
        if (
            HYBRID_CRISIS_MIN_CHARS <= len(empathy_intro) <= HYBRID_CRISIS_MAX_CHARS
            and not _contains_unverified_phone_number(empathy_intro)
        ):
            return cmd.prompt_builder.compose_hybrid_crisis_reply(
                empathy_intro,
                severity=severity,
                notification_sent=notification_sent,
            )
        if empathy_intro:
            logger.warning(
                "Hybrid crisis empathy rejected by safety filter (len=%d); using static fallback",
                len(empathy_intro),
            )
    except Exception as exc:
        logger.warning(
            "Hybrid crisis empathy LLM failed; falling back to static crisis template: %s",
            exc,
        )
    return static_fallback
