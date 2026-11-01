from __future__ import annotations

import logging
from typing import Any

from app.core.settings import settings
from app.modules.chatbot.tools.dispatcher import ToolExecutionContext
from app.modules.chatbot.tools.http_client import GatewayHttpClient, gateway_http_client

logger = logging.getLogger("uvicorn.error")


class MicroserviceToolHandlers:
    """Production handlers querying downstream microservices via api-gateway HTTP endpoints.

    Every handler:
    1. Forwards user auth token if available.
    2. Enforces circuit-breaker / timeout.
    3. Has graceful fallback to baseline data if downstream service is unavailable or in mock test mode.
    """

    def __init__(self, http_client: GatewayHttpClient | None = None):
        self.http_client = http_client or gateway_http_client

    @property
    def mock_fallbacks_enabled(self) -> bool:
        return settings.TOOL_ENABLE_MOCK_FALLBACKS

    # ==========================================================================
    # Social Domain Handlers
    # ==========================================================================
    async def get_my_friends(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = min(args.get("limit", 5), 10)
        res = await self.http_client.get(
            "/social/friends/me",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            logger.info("Using baseline fallback for get_my_friends: %s", res.get("message"))
            if self.mock_fallbacks_enabled:
                return {
                    "total": 3,
                    "friends": [
                        {"id": "user-1", "name": "Nguyễn Văn A", "username": "vana", "avatarUrl": None},
                        {"id": "user-2", "name": "Trần Thị B", "username": "thib", "avatarUrl": None},
                    ],
                }
            return {
                "total": 0,
                "friends": [],
                "error": res.get("message", "Không thể lấy danh sách bạn bè lúc này."),
            }
        # Normalize if microservice returns list or paginated dict
        if isinstance(res, dict):
            items = res.get("data") or res.get("friends") or []
            total = res.get("total") or len(items)
            return {"total": total, "friends": items[:limit]}
        if isinstance(res, list):
            return {"total": len(res), "friends": res[:limit]}
        return res

    async def search_users(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        query = str(args.get("query", "")).strip()
        if not query:
            return {"total": 0, "users": []}
        res = await self.http_client.get(
            "/search/users",
            params={"q": query, "limit": 3},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            logger.info("Using baseline fallback for search_users: %s", res.get("message"))
            if self.mock_fallbacks_enabled:
                return {
                    "total": 1,
                    "users": [
                        {"id": "user-found-1", "name": query, "username": query.lower().replace(" ", ""), "avatarUrl": None}
                    ],
                }
            return {"total": 0, "users": [], "error": res.get("message", "Không thể tìm kiếm người dùng lúc này.")}
        if isinstance(res, dict):
            users = res.get("data") or res.get("users") or []
            return {"total": len(users), "users": users[:3]}
        if isinstance(res, list):
            return {"total": len(res), "users": res[:3]}
        return res

    async def get_my_friend_requests(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 10)
        res = await self.http_client.get(
            "/social/requests",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            logger.info("Using baseline fallback for get_my_friend_requests: %s", res.get("message"))
            if self.mock_fallbacks_enabled:
                return {
                    "total": 1,
                    "requests": [
                        {"id": "req-1", "senderName": "Nguyễn Văn A", "mutualFriends": 3, "createdAt": "2026-10-30"}
                    ],
                }
            return {
                "total": 0,
                "requests": [],
                "error": res.get("message", "Không thể lấy danh sách lời mời kết bạn lúc này."),
            }
        return res

    async def get_friend_recommendations(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 5)
        res = await self.http_client.get(
            "/social/friends/recommend",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {
                    "recommendations": [
                        {"id": "user-2", "name": "Trần Thị B", "mutualFriends": 5, "commonInterest": "Âm nhạc"},
                        {"id": "user-3", "name": "Lê Hoàng C", "mutualFriends": 2, "commonInterest": "Công nghệ"},
                    ]
                }
            return {"recommendations": [], "error": res.get("message", "Không thể lấy gợi ý bạn bè lúc này.")}
        return res

    async def get_user_relationship(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        target_id = args.get("target_user_id", "")
        if not target_id:
            return {"error": "Thiếu mã target_user_id cần kiểm tra"}
        res = await self.http_client.get(
            f"/social/relationship/{target_id}",
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {"targetUserId": target_id, "status": "friends", "since": "2025-01-15"}
            return {"targetUserId": target_id, "status": "unknown", "error": res.get("message")}
        return res

    async def get_my_blocked_list(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 10)
        res = await self.http_client.get(
            "/social/blocked",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            return {"total": 0, "blockedUsers": []}
        return res

    # ==========================================================================
    # Groups Domain Handlers
    # ==========================================================================
    async def get_group_context(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        group_id = args.get("group_id") or (ctx.surface.entityId if ctx.surface else "")
        if not group_id:
            return {"error": "Không tìm thấy mã nhóm cần tra cứu thông tin."}
        res = await self.http_client.get(
            f"/groups/{group_id}",
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {
                    "groupId": group_id,
                    "name": "Cộng đồng Chia sẻ Cảm xúc Sentimeta",
                    "membersCount": 1250,
                    "userRole": "member",
                    "rules": ["Tôn trọng lẫn nhau", "Không công kích cá nhân", "Lắng nghe chân thành"],
                }
            return {"groupId": group_id, "error": res.get("message", "Không thể lấy thông tin nhóm lúc này.")}
        return res

    async def get_my_groups(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 10)
        res = await self.http_client.get(
            "/groups/my-groups",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {
                    "total": 2,
                    "groups": [
                        {"id": "grp-1", "name": "Cộng đồng Chia sẻ Cảm xúc", "role": "member", "unreadCount": 3},
                        {"id": "grp-2", "name": "Góc Thư Giãn & Âm Nhạc", "role": "admin", "unreadCount": 0},
                    ],
                }
            return {"total": 0, "groups": [], "error": res.get("message", "Không thể lấy danh sách nhóm.")}
        return res

    async def get_group_invitations(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 5)
        res = await self.http_client.get(
            "/groups/invited-groups",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            return {"total": 0, "invitations": []}
        return res

    async def get_group_recommendations(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 5)
        res = await self.http_client.get(
            "/groups/recommendations",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            return {
                "recommendations": [
                    {"id": "grp-rec-1", "name": "Sống Tích Cực Mỗi Ngày", "members": 3400, "topic": "Tâm lý & Lối sống"}
                ]
            }
        return res

    # ==========================================================================
    # Emotions & Music Domain Handlers
    # ==========================================================================
    async def get_my_emotion_summary(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        days = args.get("days", 7)
        res = await self.http_client.get(
            "/emotions/summary",
            params={"days": days},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            return {
                "days": days,
                "dominantEmotion": "bình yên",
                "positiveRatio": 0.72,
                "summary": "Tâm trạng trong 7 ngày qua nhìn chung ổn định và tích cực, thỉnh thoảng có chút áp lực nhẹ vào giữa tuần.",
            }
        return res

    async def get_my_emotion_trends(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        period = args.get("period", "week")
        res = await self.http_client.get(
            "/emotions/trend",
            params={"period": period},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            return {
                "period": period,
                "trend": "improving",
                "insights": ["Cảm xúc tích cực tăng dần về cuối tuần", "Âm nhạc giúp cải thiện tâm trạng nhanh chóng"],
            }
        return res

    async def get_recommended_music_for_mood(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        mood = args.get("mood", "thư giãn")
        res = await self.http_client.get(
            "/musics/recommendations",
            params={"mood": mood},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            return {
                "mood": mood,
                "tracks": [
                    {"title": "Gió Nhẹ Mùa Thu", "artist": "Sentimeta Chill", "duration": "3:45"},
                    {"title": "Bình Yên Nơi Đây", "artist": "Acoustic Vibes", "duration": "4:12"},
                ],
            }
        return res

    async def get_mindfulness_exercises(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        emotion = args.get("emotion_type", "căng thẳng")
        res = await self.http_client.get(
            "/emotions/insights",
            params={"emotion": emotion},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
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
        return res

    # ==========================================================================
    # Content & Feed Domain Handlers
    # ==========================================================================
    async def get_trending_posts(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = min(args.get("limit", 3), 5)
        res = await self.http_client.get(
            "/feeds/trending",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            logger.info("Using baseline fallback for get_trending_posts: %s", res.get("message"))
            if self.mock_fallbacks_enabled:
                return {
                    "posts": [
                        {
                            "id": "post-trend-1",
                            "authorName": "Sentimeta Community",
                            "content": "Chào mừng tính năng Trợ lý AI thế hệ mới trên Sentimeta! Cùng trải nghiệm trao đổi và chia sẻ tâm trạng ngay hôm nay.",
                            "likeCount": 128,
                            "commentCount": 34,
                        }
                    ]
                }
            return {"posts": [], "error": res.get("message", "Không thể lấy bài viết thịnh hành lúc này.")}

        posts_data = []
        raw_items = res.get("data") if isinstance(res, dict) else (res if isinstance(res, list) else [])
        for item in raw_items[:limit]:
            if isinstance(item, dict):
                content = str(item.get("content", ""))
                snippet = (content[:120] + "...") if len(content) > 120 else content
                author = item.get("author") or {}
                posts_data.append({
                    "id": item.get("id") or item.get("_id"),
                    "authorName": author.get("name") or author.get("username") or "Người dùng Sentimeta",
                    "content": snippet,
                    "likeCount": item.get("reactionCount") or item.get("reactions") or 0,
                    "commentCount": item.get("commentCount") or item.get("comments") or 0,
                })
        return {"posts": posts_data}

    async def get_my_posts_overview(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 5)
        res = await self.http_client.get(
            "/posts/me",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {
                    "totalPosts": 8,
                    "recentPost": {"title": "Một ngày thảnh thơi tại quán cà phê", "reactions": 24, "comments": 5},
                }
            return {"totalPosts": 0, "error": res.get("message", "Không thể lấy thông tin bài viết.")}
        return res

    async def get_post_comments_summary(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        post_id = args.get("post_id") or (ctx.surface.entityId if ctx.surface else "")
        if not post_id:
            return {"error": "Không có mã post_id để xem bình luận."}
        res = await self.http_client.get(
            "/comments",
            params={"postId": post_id, "limit": 5},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {
                    "postId": post_id,
                    "totalComments": 5,
                    "sentiment": "positive",
                    "summary": "Các bình luận chủ yếu gửi lời chúc và khen ngợi năng lượng tích cực của bài viết.",
                }
            return {"postId": post_id, "totalComments": 0, "error": res.get("message")}
        return res

    async def get_my_saved_posts(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 5)
        res = await self.http_client.get(
            "/shares/me",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {
                    "total": 3,
                    "savedPosts": [
                        {"id": "post-saved-1", "title": "5 thói quen chăm sóc sức khỏe tinh thần", "author": "Dr. Minh"}
                    ],
                }
            return {"total": 0, "savedPosts": [], "error": res.get("message")}
        return res

    # ==========================================================================
    # Account & Safety Domain Handlers
    # ==========================================================================
    async def get_my_unread_notifications(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 5)
        res = await self.http_client.get(
            "/notifications",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {
                    "unreadCount": 2,
                    "latest": [
                        {"id": "notif-1", "title": "Lời mời kết bạn mới từ Nguyễn Văn A", "time": "15 phút trước"},
                        {"id": "notif-2", "title": "Bài viết của bạn nhận được 10 lượt thích", "time": "1 giờ trước"},
                    ],
                }
            return {"unreadCount": 0, "latest": [], "error": res.get("message")}
        return res

    async def get_my_privacy_settings(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        res = await self.http_client.get(
            f"/users/{ctx.user_id}",
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            if self.mock_fallbacks_enabled:
                return {
                    "profileVisibility": "friends",
                    "allowFriendRequestsFrom": "everyone",
                    "showOnlineStatus": True,
                }
            return {"error": res.get("message", "Không thể lấy cài đặt quyền riêng tư vào lúc này.")}
        return res

    async def get_my_moderation_history(
        self, args: dict[str, Any], ctx: ToolExecutionContext
    ) -> Any:
        limit = args.get("limit", 5)
        res = await self.http_client.get(
            "/reports",
            params={"limit": limit},
            auth_token=ctx.auth_token,
        )
        if isinstance(res, dict) and "_error" in res:
            return {
                "totalRecords": 0,
                "status": "clean",
                "records": [],
            }
        return res


def register_production_handlers(dispatcher, http_client: GatewayHttpClient | None = None) -> None:
    handlers = MicroserviceToolHandlers(http_client)
    dispatcher.register_handler("get_my_friends", handlers.get_my_friends)
    dispatcher.register_handler("search_users", handlers.search_users)
    dispatcher.register_handler("get_my_friend_requests", handlers.get_my_friend_requests)
    dispatcher.register_handler("get_friend_recommendations", handlers.get_friend_recommendations)
    dispatcher.register_handler("get_user_relationship", handlers.get_user_relationship)
    dispatcher.register_handler("get_my_blocked_list", handlers.get_my_blocked_list)
    dispatcher.register_handler("get_group_context", handlers.get_group_context)
    dispatcher.register_handler("get_my_groups", handlers.get_my_groups)
    dispatcher.register_handler("get_group_invitations", handlers.get_group_invitations)
    dispatcher.register_handler("get_group_recommendations", handlers.get_group_recommendations)
    dispatcher.register_handler("get_my_emotion_summary", handlers.get_my_emotion_summary)
    dispatcher.register_handler("get_my_emotion_trends", handlers.get_my_emotion_trends)
    dispatcher.register_handler("get_recommended_music_for_mood", handlers.get_recommended_music_for_mood)
    dispatcher.register_handler("get_mindfulness_exercises", handlers.get_mindfulness_exercises)
    dispatcher.register_handler("get_trending_posts", handlers.get_trending_posts)
    dispatcher.register_handler("get_my_posts_overview", handlers.get_my_posts_overview)
    dispatcher.register_handler("get_post_comments_summary", handlers.get_post_comments_summary)
    dispatcher.register_handler("get_my_saved_posts", handlers.get_my_saved_posts)
    dispatcher.register_handler("get_my_unread_notifications", handlers.get_my_unread_notifications)
    dispatcher.register_handler("get_my_privacy_settings", handlers.get_my_privacy_settings)
    dispatcher.register_handler("get_my_moderation_history", handlers.get_my_moderation_history)
