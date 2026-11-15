from __future__ import annotations

import json
from typing import Any, AsyncIterator, Optional, Sequence

from app.modules.chatbot.schemas import AssistantRespondRequest
from app.providers.base import LlmChunk, LlmGeneration, ToolCallInfo

STUB_MODEL_NAME = "stub-deterministic"
STUB_PROVIDER_NAME = "stub"


def _extract_prompt_text(prompt: str | Sequence[Any]) -> tuple[str, bool]:
    """Flatten prompt/messages into searchable text and detect whether tool results exist."""
    if isinstance(prompt, str):
        return prompt, False

    parts: list[str] = []
    has_tool_result = False
    for item in prompt:
        if isinstance(item, dict):
            role = str(item.get("role") or "").lower()
            if role == "tool":
                has_tool_result = True
            content = str(item.get("content") or "")
            if content:
                parts.append(content)
        else:
            msg_type = str(getattr(item, "type", "")).lower()
            if msg_type == "tool":
                has_tool_result = True
            content = str(getattr(item, "content", "") or "")
            if content:
                parts.append(content)
    return "\n".join(parts), has_tool_result


class StubLlmProvider:
    """Deterministic LlmProvider for Layer 1 live verification without external LLM calls."""

    supports_chat_messages: bool = True

    async def generate(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
        model: Optional[str] = None,
        json_mode: bool = False,
        allow_paid_fallback: bool = True,
    ) -> LlmGeneration:
        del model, allow_paid_fallback
        prompt_text, has_tool_result = _extract_prompt_text(prompt)
        user_message = getattr(request, "message", "") or ""
        combined = f"{user_message}\n{prompt_text}"
        intent = getattr(request, "intent", None)

        if intent == "fact_extraction" or (
            json_mode and "Long-term Fact Extractor" in prompt_text
        ):
            payload = {
                "set": {
                    "occupation": "Kỹ sư phần mềm",
                    "sleep_health": "Hay thức khuya",
                },
                "unset": [],
            }
            return LlmGeneration(
                content=json.dumps(payload, ensure_ascii=False),
                model=STUB_MODEL_NAME,
                provider=STUB_PROVIDER_NAME,
                tool_calls=(),
            )

        if "[STUB:TOOL_FRIENDS]" in combined:
            if tools and not has_tool_result:
                return LlmGeneration(
                    content="",
                    model=STUB_MODEL_NAME,
                    provider=STUB_PROVIDER_NAME,
                    tool_calls=(
                        ToolCallInfo(
                            id="stub_call_friends_1",
                            name="get_my_friends",
                            args={"limit": 5},
                        ),
                    ),
                )
            return LlmGeneration(
                content="Đây là thông tin bạn bè của bạn từ hệ thống.",
                model=STUB_MODEL_NAME,
                provider=STUB_PROVIDER_NAME,
                tool_calls=(),
            )

        if "[STUB:ACTION_POST]" in combined:
            action_json = json.dumps(
                {
                    "actionName": "mark_all_notifications_read",
                    "title": "Đánh dấu tất cả thông báo đã đọc",
                    "description": "Đánh dấu tất cả thông báo hiện tại là đã đọc",
                    "params": {},
                },
                ensure_ascii=False,
            )
            return LlmGeneration(
                content=(
                    "Mình đã chuẩn bị thao tác để bạn xác nhận:\n"
                    f"```action\n{action_json}\n```"
                ),
                model=STUB_MODEL_NAME,
                provider=STUB_PROVIDER_NAME,
                tool_calls=(),
            )

        if "[STUB:NAV_HOME]" in combined:
            return LlmGeneration(
                content="Bạn có thể mở trang chủ (home) để xem bảng tin chính.",
                model=STUB_MODEL_NAME,
                provider=STUB_PROVIDER_NAME,
                tool_calls=(),
            )

        if "[STUB:FACT_EXTRACT]" in combined:
            return LlmGeneration(
                content="Mình đã ghi nhận chia sẻ của bạn và sẽ hỗ trợ bạn tốt hơn.",
                model=STUB_MODEL_NAME,
                provider=STUB_PROVIDER_NAME,
                tool_calls=(),
            )

        return LlmGeneration(
            content="Phản hồi từ hệ thống kiểm thử (stub).",
            model=STUB_MODEL_NAME,
            provider=STUB_PROVIDER_NAME,
            tool_calls=(),
        )

    async def stream(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
        model: Optional[str] = None,
        json_mode: bool = False,
    ) -> AsyncIterator[LlmChunk]:
        gen = await self.generate(
            prompt,
            request,
            tools=tools,
            model=model,
            json_mode=json_mode,
        )
        yield LlmChunk(
            content=gen.content,
            model=gen.model,
            provider=gen.provider,
            tool_calls=gen.tool_calls,
        )
