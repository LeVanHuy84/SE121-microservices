from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.modules.chatbot.schemas import SurfaceContext
from app.modules.chatbot.tools.catalog import ALL_TOOLS

logger = logging.getLogger("uvicorn.error")

FORBIDDEN_KEYS = frozenset(
    {
        "password",
        "token",
        "accesstoken",
        "access_token",
        "refreshtoken",
        "refresh_token",
        "secret",
        "hash",
        "internalkey",
        "internal_key",
        "phonenumber",
        "phone",
        "email",
    }
)


def sanitize_tool_output(data: Any) -> Any:
    """Recursively removes sensitive credentials and PII from tool outputs before returning to the LLM."""
    if isinstance(data, dict):
        sanitized = {}
        for key, value in data.items():
            if key.lower() in FORBIDDEN_KEYS:
                continue
            sanitized[key] = sanitize_tool_output(value)
        return sanitized
    elif isinstance(data, list):
        return [sanitize_tool_output(item) for item in data]
    return data


@dataclass(frozen=True)
class ToolExecutionContext:
    user_id: str
    auth_token: str | None = None
    surface: SurfaceContext | None = None


@dataclass(frozen=True)
class ToolExecutionResult:
    tool_name: str
    success: bool
    data: Any
    error: str | None = None
    card_payload: dict[str, Any] | None = None

    def to_tool_message_content(self) -> str:
        """Serializes safe data or error for LLM context injection."""
        import json

        if not self.success:
            return json.dumps(
                {
                    "status": "error",
                    "error": self.error or "Tool execution failed",
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "status": "success",
                "result": self.data,
            },
            ensure_ascii=False,
        )


ToolHandler = Callable[[dict[str, Any], ToolExecutionContext], Awaitable[Any]]


class ToolDispatcher:
    """Dispatches tool calls with strict execution timeouts, error handling, and PII sanitization.

    Phase 2 Guarantee: Strictly Read-Only operations.
    """

    def __init__(self, default_timeout_seconds: float = 2.0):
        self.default_timeout_seconds = default_timeout_seconds
        self._handlers: dict[str, ToolHandler] = {}
        self._register_default_handlers()

    def register_handler(self, tool_name: str, handler: ToolHandler) -> None:
        self._handlers[tool_name] = handler

    async def dispatch(
        self,
        tool_name: str,
        args: dict[str, Any],
        context: ToolExecutionContext,
        timeout_seconds: float | None = None,
    ) -> ToolExecutionResult:
        if tool_name not in ALL_TOOLS:
            logger.warning("Attempted to call unallowlisted tool: %s", tool_name)
            return ToolExecutionResult(
                tool_name=tool_name,
                success=False,
                data=None,
                error=f"Công cụ '{tool_name}' không tồn tại trong danh mục cho phép.",
            )

        handler = self._handlers.get(tool_name)
        if handler is None:
            logger.warning("No handler registered for tool: %s", tool_name)
            return ToolExecutionResult(
                tool_name=tool_name,
                success=False,
                data=None,
                error=f"Công cụ '{tool_name}' tạm thời chưa được kết nối dịch vụ.",
            )

        timeout = timeout_seconds or self.default_timeout_seconds
        try:
            raw_result = await asyncio.wait_for(handler(args, context), timeout=timeout)
            sanitized = sanitize_tool_output(raw_result)
            return ToolExecutionResult(
                tool_name=tool_name,
                success=True,
                data=sanitized,
            )
        except asyncio.TimeoutError:
            logger.warning("Tool %s timed out after %.2fs", tool_name, timeout)
            return ToolExecutionResult(
                tool_name=tool_name,
                success=False,
                data=None,
                error=f"Dịch vụ xử lý '{tool_name}' phản hồi quá thời gian quy định.",
            )
        except Exception as exc:
            logger.exception("Error executing tool %s: %s", tool_name, exc)
            return ToolExecutionResult(
                tool_name=tool_name,
                success=False,
                data=None,
                error=f"Lỗi khi thực hiện '{tool_name}': {str(exc)}",
            )

    def _register_default_handlers(self) -> None:
        """Register safe baseline stubs for all 18 tools (overridden by live clients in Slice 2.3)."""
        async def stub_friend_requests(args, ctx):
            return {
                "total": 1,
                "requests": [
                    {"id": "req-1", "senderName": "Nguyễn Văn A", "mutualFriends": 3, "createdAt": "2026-10-30"}
                ],
            }

        async def stub_friend_recommendations(args, ctx):
            return {
                "recommendations": [
                    {"id": "user-2", "name": "Trần Thị B", "mutualFriends": 5, "commonInterest": "Âm nhạc"},
                    {"id": "user-3", "name": "Lê Hoàng C", "mutualFriends": 2, "commonInterest": "Công nghệ"},
                ]
            }

        async def stub_user_relationship(args, ctx):
            target_id = args.get("target_user_id", "")
            return {"targetUserId": target_id, "status": "friends", "since": "2025-01-15"}

        async def stub_blocked_list(args, ctx):
            return {"total": 0, "blockedUsers": []}

        async def stub_group_context(args, ctx):
            gid = args.get("group_id", "")
            return {
                "groupId": gid,
                "name": "Cộng đồng Chia sẻ Cảm xúc Sentimeta",
                "membersCount": 1250,
                "userRole": "member",
                "rules": ["Tôn trọng lẫn nhau", "Không công kích cá nhân", "Lắng nghe chân thành"],
            }

        async def stub_my_groups(args, ctx):
            return {
                "total": 2,
                "groups": [
                    {"id": "grp-1", "name": "Cộng đồng Chia sẻ Cảm xúc", "role": "member", "unreadCount": 3},
                    {"id": "grp-2", "name": "Góc Thư Giãn & Âm Nhạc", "role": "admin", "unreadCount": 0},
                ],
            }

        async def stub_group_invitations(args, ctx):
            return {"total": 0, "invitations": []}

        async def stub_group_recommendations(args, ctx):
            return {
                "recommendations": [
                    {"id": "grp-rec-1", "name": "Sống Tích Cực Mỗi Ngày", "members": 3400, "topic": "Tâm lý & Lối sống"}
                ]
            }

        async def stub_emotion_summary(args, ctx):
            days = args.get("days", 7)
            return {
                "days": days,
                "dominantEmotion": "bình yên",
                "positiveRatio": 0.72,
                "summary": "Tâm trạng trong 7 ngày qua nhìn chung ổn định và tích cực, thỉnh thoảng có chút áp lực nhẹ vào giữa tuần.",
            }

        async def stub_emotion_trends(args, ctx):
            period = args.get("period", "week")
            return {
                "period": period,
                "trend": "improving",
                "insights": ["Cảm xúc tích cực tăng dần về cuối tuần", "Âm nhạc giúp cải thiện tâm trạng nhanh chóng"],
            }

        async def stub_recommended_music(args, ctx):
            mood = args.get("mood", "thư giãn")
            return {
                "mood": mood,
                "tracks": [
                    {"title": "Gió Nhẹ Mùa Thu", "artist": "Sentimeta Chill", "duration": "3:45"},
                    {"title": "Bình Yên Nơi Đây", "artist": "Acoustic Vibes", "duration": "4:12"},
                ],
            }

        async def stub_mindfulness_exercises(args, ctx):
            emotion = args.get("emotion_type", "căng thẳng")
            return {
                "emotionType": emotion,
                "exerciseName": "Kỹ thuật thở 4-7-8 giúp thư giãn thần kinh",
                "durationMinutes": 5,
                "steps": [
                    "Hít vào sâu bằng mũi trong 4 giây",
                    "Giữ hơi thở trong 7 giây",
                    "Thở ra từ từ bằng miệng trong 8 giây",
                    "Lặp lại chu kỳ 4 lần",
                ],
            }

        async def stub_my_posts_overview(args, ctx):
            return {
                "totalPosts": 8,
                "recentPost": {"title": "Một ngày thảnh thơi tại quán cà phê", "reactions": 24, "comments": 5},
            }

        async def stub_post_comments_summary(args, ctx):
            pid = args.get("post_id", "")
            return {
                "postId": pid,
                "totalComments": 5,
                "sentiment": "positive",
                "summary": "Các bình luận chủ yếu gửi lời chúc và khen ngợi năng lượng tích cực của bài viết.",
            }

        async def stub_saved_posts(args, ctx):
            return {
                "total": 3,
                "savedPosts": [
                    {"id": "post-saved-1", "title": "5 thói quen chăm sóc sức khỏe tinh thần", "author": "Dr. Minh"}
                ],
            }

        async def stub_unread_notifications(args, ctx):
            return {
                "unreadCount": 2,
                "latest": [
                    {"id": "notif-1", "title": "Lời mời kết bạn mới từ Nguyễn Văn A", "time": "15 phút trước"},
                    {"id": "notif-2", "title": "Bài viết của bạn nhận được 10 lượt thích", "time": "1 giờ trước"},
                ],
            }

        async def stub_privacy_settings(args, ctx):
            return {
                "profileVisibility": "friends",
                "allowFriendRequestsFrom": "everyone",
                "showOnlineStatus": True,
            }

        async def stub_moderation_history(args, ctx):
            return {
                "totalRecords": 0,
                "status": "clean",
                "records": [],
            }

        self.register_handler("get_my_friend_requests", stub_friend_requests)
        self.register_handler("get_friend_recommendations", stub_friend_recommendations)
        self.register_handler("get_user_relationship", stub_user_relationship)
        self.register_handler("get_my_blocked_list", stub_blocked_list)
        self.register_handler("get_group_context", stub_group_context)
        self.register_handler("get_my_groups", stub_my_groups)
        self.register_handler("get_group_invitations", stub_group_invitations)
        self.register_handler("get_group_recommendations", stub_group_recommendations)
        self.register_handler("get_my_emotion_summary", stub_emotion_summary)
        self.register_handler("get_my_emotion_trends", stub_emotion_trends)
        self.register_handler("get_recommended_music_for_mood", stub_recommended_music)
        self.register_handler("get_mindfulness_exercises", stub_mindfulness_exercises)
        self.register_handler("get_my_posts_overview", stub_my_posts_overview)
        self.register_handler("get_post_comments_summary", stub_post_comments_summary)
        self.register_handler("get_my_saved_posts", stub_saved_posts)
        self.register_handler("get_my_unread_notifications", stub_unread_notifications)
        self.register_handler("get_my_privacy_settings", stub_privacy_settings)
        self.register_handler("get_my_moderation_history", stub_moderation_history)


tool_dispatcher = ToolDispatcher()
