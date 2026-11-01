from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    domain: str
    description: str
    parameters: dict[str, Any]
    target_service: str

    def to_openai_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


# ==============================================================================
# Domain 1: Social & Friends (user-social-service)
# ==============================================================================
GET_MY_FRIEND_REQUESTS = ToolDefinition(
    name="get_my_friend_requests",
    domain="social",
    target_service="user-social-service",
    description="Lấy danh sách các lời mời kết bạn đang chờ người dùng hiện tại phản hồi hoặc đồng ý.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng lời mời tối đa cần lấy (mặc định 10)",
                "default": 10,
            }
        },
        "required": [],
    },
)

GET_FRIEND_RECOMMENDATIONS = ToolDefinition(
    name="get_friend_recommendations",
    domain="social",
    target_service="user-social-service",
    description="Gợi ý bạn bè mới phù hợp dựa trên sở thích chung, bạn bè chung hoặc hoạt động gần đây.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng gợi ý tối đa cần lấy (mặc định 5)",
                "default": 5,
            }
        },
        "required": [],
    },
)

GET_USER_RELATIONSHIP = ToolDefinition(
    name="get_user_relationship",
    domain="social",
    target_service="user-social-service",
    description="Kiểm tra mối quan hệ giữa người dùng hiện tại và một người dùng khác (đã kết bạn, đang chờ, hoặc chưa kết bạn).",
    parameters={
        "type": "object",
        "properties": {
            "target_user_id": {
                "type": "string",
                "description": "Mã định danh (ID) của người dùng cần kiểm tra quan hệ",
            }
        },
        "required": ["target_user_id"],
    },
)

GET_MY_FRIENDS = ToolDefinition(
    name="get_my_friends",
    domain="social",
    target_service="user-social-service",
    description="Lấy tổng số lượng và danh sách bạn bè hiện tại trong danh bạ mạng xã hội của tôi.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng bạn bè cần lấy (mặc định 5, tối đa 10)",
                "default": 5,
            }
        },
        "required": [],
    },
)

SEARCH_USERS = ToolDefinition(
    name="search_users",
    domain="social",
    target_service="search-recommendation-service",
    description="Tìm kiếm người dùng hoặc bạn bè trên mạng xã hội bằng tên hiển thị hoặc username (tối đa 3 kết quả).",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Tên hoặc username người dùng cần tìm",
            }
        },
        "required": ["query"],
    },
)

GET_MY_BLOCKED_LIST = ToolDefinition(
    name="get_my_blocked_list",
    domain="social",
    target_service="user-social-service",
    description="Lấy danh sách các tài khoản người dùng mà tôi đang chặn.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng tối đa (mặc định 10)",
                "default": 10,
            }
        },
        "required": [],
    },
)

# ==============================================================================
# Domain 2: Groups (group-service)
# ==============================================================================
GET_GROUP_CONTEXT = ToolDefinition(
    name="get_group_context",
    domain="groups",
    target_service="group-service",
    description="Lấy thông tin chi tiết, quy tắc, admin và trạng thái thành viên của một nhóm cụ thể.",
    parameters={
        "type": "object",
        "properties": {
            "group_id": {
                "type": "string",
                "description": "Mã ID của nhóm cần xem thông tin",
            }
        },
        "required": ["group_id"],
    },
)

GET_MY_GROUPS = ToolDefinition(
    name="get_my_groups",
    domain="groups",
    target_service="group-service",
    description="Lấy danh sách các nhóm mà người dùng đang tham gia làm thành viên hoặc quản trị viên.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng nhóm tối đa cần lấy (mặc định 10)",
                "default": 10,
            }
        },
        "required": [],
    },
)

GET_GROUP_INVITATIONS = ToolDefinition(
    name="get_group_invitations",
    domain="groups",
    target_service="group-service",
    description="Lấy danh sách các lời mời tham gia nhóm đang chờ người dùng phản hồi.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng lời mời tối đa (mặc định 5)",
                "default": 5,
            }
        },
        "required": [],
    },
)

GET_GROUP_RECOMMENDATIONS = ToolDefinition(
    name="get_group_recommendations",
    domain="groups",
    target_service="group-service",
    description="Gợi ý các nhóm cộng đồng phù hợp với sở thích hoặc xu hướng quan tâm của người dùng.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng gợi ý tối đa (mặc định 5)",
                "default": 5,
            }
        },
        "required": [],
    },
)

# ==============================================================================
# Domain 3: Emotions & Music (emotion-intelligence-service & music-service)
# ==============================================================================
GET_MY_EMOTION_SUMMARY = ToolDefinition(
    name="get_my_emotion_summary",
    domain="emotions",
    target_service="emotion-intelligence-service",
    description="Lấy tóm tắt và phân tích cảm xúc gần đây (7 ngày qua) của người dùng hiện tại.",
    parameters={
        "type": "object",
        "properties": {
            "days": {
                "type": "integer",
                "description": "Số ngày cần tổng hợp dữ liệu (mặc định 7)",
                "default": 7,
            }
        },
        "required": [],
    },
)

GET_MY_EMOTION_TRENDS = ToolDefinition(
    name="get_my_emotion_trends",
    domain="emotions",
    target_service="emotion-intelligence-service",
    description="Lấy báo cáo xu hướng và biến động cảm xúc (tích cực, tiêu cực, biến động) theo tuần hoặc tháng.",
    parameters={
        "type": "object",
        "properties": {
            "period": {
                "type": "string",
                "enum": ["week", "month"],
                "description": "Khoảng thời gian: 'week' (tuần) hoặc 'month' (tháng)",
                "default": "week",
            }
        },
        "required": [],
    },
)

GET_RECOMMENDED_MUSIC_FOR_MOOD = ToolDefinition(
    name="get_recommended_music_for_mood",
    domain="emotions",
    target_service="music-service",
    description="Gợi ý danh sách bài hát giúp cải thiện hoặc phù hợp với tâm trạng hiện tại của người dùng.",
    parameters={
        "type": "object",
        "properties": {
            "mood": {
                "type": "string",
                "description": "Tâm trạng mong muốn hoặc hiện tại (ví dụ: vui vẻ, thư giãn, tập trung, nhẹ nhàng)",
            }
        },
        "required": [],
    },
)

GET_MINDFULNESS_EXERCISES = ToolDefinition(
    name="get_mindfulness_exercises",
    domain="emotions",
    target_service="emotion-intelligence-service",
    description="Gợi ý các bài tập thở, thư giãn tâm trí hoặc bài tập chánh niệm phù hợp với trạng thái cảm xúc.",
    parameters={
        "type": "object",
        "properties": {
            "emotion_type": {
                "type": "string",
                "description": "Trạng thái cảm xúc hiện tại (ví dụ: căng thẳng, lo âu, mệt mỏi, áp lực)",
            }
        },
        "required": [],
    },
)

# ==============================================================================
# Domain 4: Content & Feed (content-feed-service)
# ==============================================================================
GET_MY_POSTS_OVERVIEW = ToolDefinition(
    name="get_my_posts_overview",
    domain="content",
    target_service="content-feed-service",
    description="Lấy thống kê và danh sách bài viết gần đây cùng lượt tương tác của người dùng.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng bài viết cần lấy (mặc định 5)",
                "default": 5,
            }
        },
        "required": [],
    },
)

GET_POST_COMMENTS_SUMMARY = ToolDefinition(
    name="get_post_comments_summary",
    domain="content",
    target_service="content-feed-service",
    description="Lấy tóm tắt nội dung và các ý kiến chính trong bình luận của một bài viết cụ thể.",
    parameters={
        "type": "object",
        "properties": {
            "post_id": {
                "type": "string",
                "description": "Mã ID của bài viết cần tóm tắt bình luận",
            }
        },
        "required": ["post_id"],
    },
)

GET_MY_SAVED_POSTS = ToolDefinition(
    name="get_my_saved_posts",
    domain="content",
    target_service="content-feed-service",
    description="Lấy danh sách các bài viết mà người dùng đã lưu lại để xem sau.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng bài viết đã lưu cần lấy (mặc định 5)",
                "default": 5,
            }
        },
        "required": [],
    },
)

GET_TRENDING_POSTS = ToolDefinition(
    name="get_trending_posts",
    domain="content",
    target_service="content-feed-service",
    description="Lấy top 3 bài viết thịnh hành và được quan tâm nhiều nhất gần đây trên mạng xã hội Sentimeta.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng bài viết thịnh hành cần lấy (mặc định 3, tối đa 3)",
                "default": 3,
            }
        },
        "required": [],
    },
)

# ==============================================================================
# Domain 5: Account & Safety (notification-service, user-social-service, moderation-service)
# ==============================================================================
GET_MY_UNREAD_NOTIFICATIONS = ToolDefinition(
    name="get_my_unread_notifications",
    domain="account",
    target_service="notification-service",
    description="Lấy số lượng và danh sách tóm tắt các thông báo mới nhất chưa đọc của người dùng.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng thông báo tối đa (mặc định 5)",
                "default": 5,
            }
        },
        "required": [],
    },
)

GET_MY_PRIVACY_SETTINGS = ToolDefinition(
    name="get_my_privacy_settings",
    domain="account",
    target_service="user-social-service",
    description="Lấy thông tin cấu hình và cài đặt quyền riêng tư hiện tại của tài khoản người dùng.",
    parameters={
        "type": "object",
        "properties": {},
        "required": [],
    },
)

GET_MY_MODERATION_HISTORY = ToolDefinition(
    name="get_my_moderation_history",
    domain="account",
    target_service="moderation-service",
    description="Lấy lịch sử các bài viết hoặc bình luận của tôi từng bị hệ thống cảnh báo hoặc kiểm duyệt.",
    parameters={
        "type": "object",
        "properties": {
            "limit": {
                "type": "integer",
                "description": "Số lượng bản ghi tối đa (mặc định 5)",
                "default": 5,
            }
        },
        "required": [],
    },
)

# Registry of all 21 tools
ALL_TOOLS: dict[str, ToolDefinition] = {
    # Social
    GET_MY_FRIENDS.name: GET_MY_FRIENDS,
    SEARCH_USERS.name: SEARCH_USERS,
    GET_MY_FRIEND_REQUESTS.name: GET_MY_FRIEND_REQUESTS,
    GET_FRIEND_RECOMMENDATIONS.name: GET_FRIEND_RECOMMENDATIONS,
    GET_USER_RELATIONSHIP.name: GET_USER_RELATIONSHIP,
    GET_MY_BLOCKED_LIST.name: GET_MY_BLOCKED_LIST,
    # Groups
    GET_GROUP_CONTEXT.name: GET_GROUP_CONTEXT,
    GET_MY_GROUPS.name: GET_MY_GROUPS,
    GET_GROUP_INVITATIONS.name: GET_GROUP_INVITATIONS,
    GET_GROUP_RECOMMENDATIONS.name: GET_GROUP_RECOMMENDATIONS,
    # Emotions & Music
    GET_MY_EMOTION_SUMMARY.name: GET_MY_EMOTION_SUMMARY,
    GET_MY_EMOTION_TRENDS.name: GET_MY_EMOTION_TRENDS,
    GET_RECOMMENDED_MUSIC_FOR_MOOD.name: GET_RECOMMENDED_MUSIC_FOR_MOOD,
    GET_MINDFULNESS_EXERCISES.name: GET_MINDFULNESS_EXERCISES,
    # Content
    GET_TRENDING_POSTS.name: GET_TRENDING_POSTS,
    GET_MY_POSTS_OVERVIEW.name: GET_MY_POSTS_OVERVIEW,
    GET_POST_COMMENTS_SUMMARY.name: GET_POST_COMMENTS_SUMMARY,
    GET_MY_SAVED_POSTS.name: GET_MY_SAVED_POSTS,
    # Account
    GET_MY_UNREAD_NOTIFICATIONS.name: GET_MY_UNREAD_NOTIFICATIONS,
    GET_MY_PRIVACY_SETTINGS.name: GET_MY_PRIVACY_SETTINGS,
    GET_MY_MODERATION_HISTORY.name: GET_MY_MODERATION_HISTORY,
}

DOMAIN_TOOLS: dict[str, list[ToolDefinition]] = {
    "social": [
        GET_MY_FRIENDS,
        SEARCH_USERS,
        GET_MY_FRIEND_REQUESTS,
        GET_FRIEND_RECOMMENDATIONS,
        GET_USER_RELATIONSHIP,
        GET_MY_BLOCKED_LIST,
    ],
    "groups": [
        GET_GROUP_CONTEXT,
        GET_MY_GROUPS,
        GET_GROUP_INVITATIONS,
        GET_GROUP_RECOMMENDATIONS,
    ],
    "emotions": [
        GET_MY_EMOTION_SUMMARY,
        GET_MY_EMOTION_TRENDS,
        GET_RECOMMENDED_MUSIC_FOR_MOOD,
        GET_MINDFULNESS_EXERCISES,
    ],
    "content": [
        GET_TRENDING_POSTS,
        GET_MY_POSTS_OVERVIEW,
        GET_POST_COMMENTS_SUMMARY,
        GET_MY_SAVED_POSTS,
    ],
    "account": [
        GET_MY_UNREAD_NOTIFICATIONS,
        GET_MY_PRIVACY_SETTINGS,
        GET_MY_MODERATION_HISTORY,
    ],
}


def get_tool_by_name(name: str) -> ToolDefinition | None:
    return ALL_TOOLS.get(name)
