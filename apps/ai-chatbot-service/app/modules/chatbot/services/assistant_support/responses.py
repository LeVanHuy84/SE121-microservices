from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from app.modules.chatbot.schemas import (
    AssistantRespondData,
    AssistantRespondRequest,
    CrisisInfo,
    CrisisResource,
)
from app.modules.chatbot.services.prompt_builder import CRISIS_RESOURCES

logger = logging.getLogger("uvicorn.error")

_CRISIS_ALERT_TIMEOUT_SECONDS = 0.028
_ALERT_RISK_LEVEL = {"high": "crisis", "medium": "high"}
_ALERT_REASON = {
    "explicit_crisis": "Người dùng thể hiện ý định tự hại hoặc tự sát khi trò chuyện với chatbot.",
    "soft_crisis": "Người dùng có dấu hiệu tuyệt vọng hoặc cô đơn kéo dài khi trò chuyện với chatbot.",
}
_ALERT_REASON_DEFAULT = "Chatbot phát hiện dấu hiệu khủng hoảng tâm lý ở người dùng."


def in_domain_unknown_response(
    matched_domains: tuple[str, ...],
) -> AssistantRespondData:
    domain_hint = (
        ", ".join(matched_domains[:3]) if matched_domains else "hệ thống Sentimeta"
    )
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


def privacy_policy_response() -> AssistantRespondData:
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


def out_of_scope_response() -> AssistantRespondData:
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


def greeting_response() -> AssistantRespondData:
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


def ambiguous_scope_response(
    matched_domains: tuple[str, ...],
) -> AssistantRespondData:
    domain_hint = (
        ", ".join(matched_domains[:3]) if matched_domains else "hệ thống Sentimeta"
    )
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


def community_response(reason: str) -> AssistantRespondData:
    if reason in {"community_violation", "unsafe_content"}:
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


def build_crisis_response(
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


async def emit_crisis_event(
    request: AssistantRespondRequest,
    severity: str,
    rule: str,
    conversation_id: str | None = None,
    kafka_producer: Any = None,
    outbox_repo: Any = None,
) -> bool:
    """Emit a Kafka event alerting the support team about a mental health crisis.

    The payload does NOT contain the message text (to minimize personal data): `reason` is a
    fixed neutral description chosen by rule code (e.g. explicit_crisis). Field names
    `riskLevel`/`reason` and the `crisis`/`high` values are kept for compatibility with the
    emotion-intelligence-service consumer.

    Returns True only if the event was sent successfully within the allowed time.
    """
    try:
        if kafka_producer is None or outbox_repo is None:
            from app.core.messaging import get_kafka_producer, get_outbox_repo

            kafka_producer = kafka_producer or get_kafka_producer()
            outbox_repo = outbox_repo or get_outbox_repo()

        timestamp_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        resolved_conv_id = conversation_id or request.conversationId
        payload = {
            "userId": request.userId,
            "conversationId": resolved_conv_id,
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
            logger.warning(
                "[CrisisGuard] Kafka emit failed, saving to DLQ/Outbox: %s", exc
            )
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
        logger.warning(
            "[CrisisGuard] Failed to handle crisis alert (Kafka & Outbox failed): %s",
            exc,
        )
        return False
