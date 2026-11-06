from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ActionDefinition:
    name: str
    domain: str
    description: str
    required_params: tuple[str, ...]
    confirm_label: str
    cancel_label: str
    category: str = "social"
    is_destructive: bool = False


SEND_FRIEND_REQUEST = ActionDefinition(
    name="send_friend_request",
    domain="social",
    category="social",
    description="Gửi lời mời kết bạn tới người dùng khác",
    required_params=("target_user_id",),
    confirm_label="Gửi lời mời",
    cancel_label="Hủy",
    is_destructive=False,
)

ACCEPT_FRIEND_REQUEST = ActionDefinition(
    name="accept_friend_request",
    domain="social",
    category="social",
    description="Chấp nhận lời mời kết bạn từ người dùng khác",
    required_params=("requester_id",),
    confirm_label="Chấp nhận",
    cancel_label="Bỏ qua",
    is_destructive=False,
)

DECLINE_FRIEND_REQUEST = ActionDefinition(
    name="decline_friend_request",
    domain="social",
    category="social",
    description="Từ chối lời mời kết bạn từ người dùng khác",
    required_params=("requester_id",),
    confirm_label="Từ chối",
    cancel_label="Bỏ qua",
    is_destructive=True,
)

CANCEL_FRIEND_REQUEST = ActionDefinition(
    name="cancel_friend_request",
    domain="social",
    category="social",
    description="Thu hồi lời mời kết bạn đã gửi",
    required_params=("target_user_id",),
    confirm_label="Thu hồi",
    cancel_label="Không",
    is_destructive=True,
)

UNFRIEND_USER = ActionDefinition(
    name="unfriend_user",
    domain="social",
    category="social",
    description="Hủy quan hệ bạn bè với người dùng này",
    required_params=("target_user_id",),
    confirm_label="Hủy kết bạn",
    cancel_label="Giữ lại",
    is_destructive=True,
)

BLOCK_USER = ActionDefinition(
    name="block_user",
    domain="social",
    category="social",
    description="Chặn người dùng này để ngăn chặn tương tác hoặc xem nội dung",
    required_params=("target_user_id",),
    confirm_label="Chặn người dùng",
    cancel_label="Hủy",
    is_destructive=True,
)

JOIN_GROUP = ActionDefinition(
    name="join_group",
    domain="groups",
    category="group",
    description="Tham gia hoặc gửi yêu cầu tham gia nhóm cộng đồng",
    required_params=("group_id",),
    confirm_label="Tham gia nhóm",
    cancel_label="Hủy",
    is_destructive=False,
)

LEAVE_GROUP = ActionDefinition(
    name="leave_group",
    domain="groups",
    category="group",
    description="Rời khỏi nhóm cộng đồng",
    required_params=("group_id",),
    confirm_label="Rời nhóm",
    cancel_label="Ở lại",
    is_destructive=True,
)

REACT_POST = ActionDefinition(
    name="react_post",
    domain="content",
    category="content",
    description="Thả cảm xúc cho bài viết",
    required_params=("post_id",),
    confirm_label="Thả cảm xúc",
    cancel_label="Hủy",
    is_destructive=False,
)

MARK_ALL_NOTIFICATIONS_READ = ActionDefinition(
    name="mark_all_notifications_read",
    domain="account",
    category="notification",
    description="Đánh dấu tất cả thông báo hiện tại là đã đọc",
    required_params=(),
    confirm_label="Đánh dấu đã đọc",
    cancel_label="Hủy",
    is_destructive=False,
)

ALLOWLISTED_ACTIONS: dict[str, ActionDefinition] = {
    SEND_FRIEND_REQUEST.name: SEND_FRIEND_REQUEST,
    ACCEPT_FRIEND_REQUEST.name: ACCEPT_FRIEND_REQUEST,
    DECLINE_FRIEND_REQUEST.name: DECLINE_FRIEND_REQUEST,
    CANCEL_FRIEND_REQUEST.name: CANCEL_FRIEND_REQUEST,
    UNFRIEND_USER.name: UNFRIEND_USER,
    BLOCK_USER.name: BLOCK_USER,
    JOIN_GROUP.name: JOIN_GROUP,
    LEAVE_GROUP.name: LEAVE_GROUP,
    REACT_POST.name: REACT_POST,
    MARK_ALL_NOTIFICATIONS_READ.name: MARK_ALL_NOTIFICATIONS_READ,
}


def is_action_allowed(action_name: str) -> bool:
    return action_name in ALLOWLISTED_ACTIONS


def get_action_definition(action_name: str) -> ActionDefinition | None:
    return ALLOWLISTED_ACTIONS.get(action_name)
