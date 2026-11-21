from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ActionDefinition:
    name: str
    domain: str
    description: str
    required_params: tuple[str, ...]
    confirm_label: str
    cancel_label: str
    category: str = "account"
    is_destructive: bool = False


# Only zero-ambiguity global/account actions are allowlisted for chat execution.
# Person/group-targeted Tier A actions are handled via Interactive Mini Cards (FE calls
# native gateway APIs directly with backend-bound IDs), and Tier B destructive actions
# are intentionally excluded from chat execution.
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
    MARK_ALL_NOTIFICATIONS_READ.name: MARK_ALL_NOTIFICATIONS_READ,
}


def is_action_allowed(action_name: str) -> bool:
    return action_name in ALLOWLISTED_ACTIONS


def get_action_definition(action_name: str) -> ActionDefinition | None:
    return ALLOWLISTED_ACTIONS.get(action_name)
