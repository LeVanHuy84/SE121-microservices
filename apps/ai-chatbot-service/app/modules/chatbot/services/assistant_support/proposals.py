from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import json
import logging
import re
import time
from typing import Any
from uuid import uuid4

from app.core.settings import settings
from app.modules.chatbot.actions.registry import (
    get_action_definition,
    is_action_allowed,
)
from app.modules.chatbot.schemas import (
    AssistantRespondRequest,
    CardPayload,
    ProposeAction,
    ProposeActionPayload,
    ShowCardAction,
)

logger = logging.getLogger("uvicorn.error")


def compute_params_hash(params: dict[str, Any] | None) -> str:
    canonical_params = json.dumps(
        params or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(canonical_params.encode("utf-8")).hexdigest()


def sign_proposal_token(
    *,
    user_id: str,
    conversation_id: str,
    action_id: str,
    action_name: str,
    params: dict[str, Any] | None,
    idempotency_key: str,
    expires_at: int | None = None,
) -> tuple[str, int]:
    resolved_exp = (
        expires_at
        if expires_at is not None
        else int(time.time()) + settings.PROPOSAL_TOKEN_TTL_SECONDS
    )
    params_hash = compute_params_hash(params)
    canonical = (
        f"{user_id}|{conversation_id}|{action_id}|{action_name}|"
        f"{params_hash}|{idempotency_key}|{resolved_exp}"
    )
    digest = hmac.new(
        settings.PROPOSAL_HMAC_KEY.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{resolved_exp}.{digest}", resolved_exp


def verify_proposal_token(
    *,
    token: str,
    user_id: str,
    conversation_id: str,
    action_id: str,
    action_name: str,
    params: dict[str, Any] | None,
    idempotency_key: str,
) -> tuple[bool, str | None]:
    if not token or "." not in token:
        return False, "PROPOSAL_TOKEN_INVALID"

    exp_str, provided_sig = token.split(".", 1)
    try:
        expires_at = int(exp_str)
    except ValueError:
        return False, "PROPOSAL_TOKEN_INVALID"

    if not provided_sig:
        return False, "PROPOSAL_TOKEN_INVALID"

    expected_token, _ = sign_proposal_token(
        user_id=user_id,
        conversation_id=conversation_id,
        action_id=action_id,
        action_name=action_name,
        params=params,
        idempotency_key=idempotency_key,
        expires_at=expires_at,
    )
    _, expected_sig = expected_token.split(".", 1)
    if not hmac.compare_digest(provided_sig, expected_sig):
        return False, "PROPOSAL_TOKEN_INVALID"

    if int(time.time()) > expires_at:
        return False, "PROPOSAL_TOKEN_EXPIRED"

    return True, None


def _build_signed_proposal(
    *,
    user_id: str,
    conversation_id: str,
    action_name: str,
    title: str,
    description: str,
    params: dict[str, Any] | None = None,
    confirm_label: str = "Xác nhận",
    cancel_label: str = "Hủy",
    category: str = "social",
    is_destructive: bool = False,
) -> ProposeAction:
    action_id = str(uuid4())
    idempotency_key = str(uuid4())
    normalized_params = params if isinstance(params, dict) else {}
    proposal_token, expires_at = sign_proposal_token(
        user_id=user_id,
        conversation_id=conversation_id,
        action_id=action_id,
        action_name=action_name,
        params=normalized_params,
        idempotency_key=idempotency_key,
    )
    return ProposeAction(
        id=action_id,
        label=confirm_label,
        payload=ProposeActionPayload(
            actionName=action_name,
            title=title,
            description=description,
            params=normalized_params,
            idempotencyKey=idempotency_key,
            proposalToken=proposal_token,
            confirmLabel=confirm_label,
            cancelLabel=cancel_label,
            category=category,
            isDestructive=is_destructive,
            expiresAt=datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
        ),
    )


_TIER_B_DESTRUCTIVE_CUES: tuple[str, ...] = (
    "chặn",
    "block",
    "hủy kết bạn",
    "unfriend",
    "xóa bạn",
    "rời nhóm",
    "thoát nhóm",
    "leave group",
    "từ chối",
    "thu hồi",
)


def extract_cards(
    tool_calls: tuple[Any, ...],
    tool_results: list[Any],
    user_message: str = "",
) -> list[ShowCardAction]:
    """Extract interactive UI cards from read tool execution results."""
    cards: list[ShowCardAction] = []
    lowered_msg = (user_message or "").lower()
    is_tier_b_request = any(cue in lowered_msg for cue in _TIER_B_DESTRUCTIVE_CUES)
    for tc, res in zip(tool_calls, tool_results):
        if not getattr(res, "success", False) or getattr(res, "data", None) is None:
            continue
        data = res.data
        name = getattr(tc, "name", "")

        # 1. Profile cards
        if name in (
            "get_my_friends",
            "search_users",
            "get_friend_recommendations",
            "get_my_friend_requests",
        ):
            user_list = []
            if isinstance(data, dict):
                user_list = (
                    data.get("friends")
                    or data.get("users")
                    or data.get("recommendations")
                    or data.get("requests")
                    or []
                )
            elif isinstance(data, list):
                user_list = data
            for u in user_list[:2]:
                if isinstance(u, dict):
                    u_name = (
                        u.get("name")
                        or u.get("senderName")
                        or u.get("username")
                        or "Người dùng"
                    )
                    u_sub = (
                        f"@{u['username']}"
                        if u.get("username")
                        else (
                            f"{u.get('mutualFriends', 0)} bạn chung"
                            if u.get("mutualFriends")
                            else "Thành viên Sentimeta"
                        )
                    )
                    canonical_user_id = (
                        u.get("id")
                        or u.get("userId")
                        or u.get("requesterId")
                        or u.get("senderId")
                        or u.get("targetUserId")
                    )
                    username_or_id = u.get("username") or canonical_user_id or ""
                    inline_action = (
                        None
                        if is_tier_b_request
                        else (
                            "accept_friend_request"
                            if name == "get_my_friend_requests"
                            else (
                                "send_friend_request"
                                if name in ("search_users", "get_friend_recommendations")
                                else None
                            )
                        )
                    )
                    cards.append(
                        ShowCardAction(
                            label="Xem trang cá nhân",
                            payload=CardPayload(
                                cardType="profile",
                                title=u_name,
                                subtitle=u_sub,
                                imageUrl=u.get("avatarUrl"),
                                actionUrl=f"/profile/{username_or_id}"
                                if username_or_id
                                else "/friends",
                                actionLabel="Xem trang cá nhân",
                                metadata={
                                    "userId": canonical_user_id,
                                    "username": u.get("username"),
                                    "destinationId": "profile",
                                    "entityId": canonical_user_id,
                                    "interactionMode": (
                                        "inline_tier_a"
                                        if inline_action
                                        else "view_only"
                                    ),
                                    "inlineAction": inline_action,
                                },
                            ),
                        )
                    )

        # 2. Group cards
        elif name in (
            "get_group_context",
            "get_my_groups",
            "get_group_recommendations",
            "get_group_invitations",
        ):
            group_list = []
            if isinstance(data, dict):
                group_list = (
                    data.get("groups")
                    or data.get("recommendations")
                    or data.get("invitations")
                    or [data]
                )
            elif isinstance(data, list):
                group_list = data
            for g in group_list[:2]:
                if isinstance(g, dict) and (g.get("id") or g.get("name")):
                    g_name = g.get("name") or "Nhóm cộng đồng"
                    m_count = g.get("memberCount") or g.get("membersCount") or 0
                    g_sub = (
                        f"{m_count} thành viên" if m_count else "Cộng đồng Sentimeta"
                    )
                    g_id = g.get("id") or g.get("groupId") or ""
                    group_inline_action = (
                        None
                        if is_tier_b_request
                        else (
                            "join_group"
                            if name
                            in ("get_group_recommendations", "get_group_invitations")
                            else None
                        )
                    )
                    cards.append(
                        ShowCardAction(
                            label="Xem nhóm",
                            payload=CardPayload(
                                cardType="group",
                                title=g_name,
                                subtitle=g_sub,
                                imageUrl=g.get("avatarUrl") or g.get("coverUrl"),
                                actionUrl=f"/groups/{g_id}" if g_id else "/groups",
                                actionLabel="Xem nhóm",
                                metadata={
                                    "groupId": g_id,
                                    "destinationId": "groups.detail",
                                    "entityId": g_id,
                                    "interactionMode": (
                                        "inline_tier_a"
                                        if group_inline_action
                                        else "view_only"
                                    ),
                                    "inlineAction": group_inline_action,
                                },
                            ),
                        )
                    )

        # 3. Music cards
        elif name == "get_recommended_music_for_mood":
            track_list = []
            if isinstance(data, dict):
                track_list = (
                    data.get("tracks")
                    or data.get("data")
                    or data.get("recommendations")
                    or [data]
                )
            elif isinstance(data, list):
                track_list = data
            for t in track_list[:2]:
                if isinstance(t, dict):
                    t_title = t.get("title") or t.get("name") or "Bài hát thư giãn"
                    t_artist = t.get("artist") or "Nghệ sĩ Sentimeta"
                    cards.append(
                        ShowCardAction(
                            label="Nghe thử",
                            payload=CardPayload(
                                cardType="music",
                                title=t_title,
                                subtitle=t_artist,
                                imageUrl=t.get("coverUrl") or t.get("thumbnailUrl"),
                                actionUrl=t.get("previewUrl")
                                or t.get("streamUrl")
                                or f"/music/{t.get('id', '')}",
                                actionLabel="Nghe thử",
                                metadata={
                                    "trackId": t.get("id"),
                                    "previewUrl": t.get("previewUrl"),
                                },
                            ),
                        )
                    )

        # 4. Post cards
        elif name in (
            "get_trending_posts",
            "get_my_posts_overview",
            "get_my_saved_posts",
        ):
            post_list = []
            if isinstance(data, dict):
                post_list = data.get("posts") or data.get("data") or [data]
            elif isinstance(data, list):
                post_list = data
            for p in post_list[:2]:
                if isinstance(p, dict) and (p.get("id") or p.get("content")):
                    p_author = p.get("authorName") or "Bài viết nổi bật"
                    p_content = str(p.get("content", ""))
                    p_sub = (
                        (p_content[:75] + "...") if len(p_content) > 75 else p_content
                    )
                    p_id = p.get("id") or ""
                    cards.append(
                        ShowCardAction(
                            label="Xem bài viết",
                            payload=CardPayload(
                                cardType="post",
                                title=p_author,
                                subtitle=p_sub,
                                imageUrl=p.get("thumbnailUrl"),
                                actionUrl=f"/posts/{p_id}" if p_id else "/feed",
                                actionLabel="Xem bài viết",
                                metadata={"postId": p_id},
                            ),
                        )
                    )

        # 5. Emotion cards
        elif name in ("get_my_emotion_summary", "get_my_emotion_trends"):
            if isinstance(data, dict):
                dominant = data.get("dominantEmotion") or data.get("topEmotion")
                if dominant:
                    cards.append(
                        ShowCardAction(
                            label="Xem phân tích",
                            payload=CardPayload(
                                cardType="emotion",
                                title=f"Tâm trạng: {dominant}",
                                subtitle="Báo cáo phân tích cảm xúc cá nhân gần đây",
                                actionUrl="/emotions",
                                actionLabel="Xem phân tích cảm xúc",
                                metadata=data,
                            ),
                        )
                    )

    return cards[:2]


def extract_proposals_from_llm_reply(
    reply: str,
    ai_policy: str = "RESTRICTED",
    *,
    user_id: str = "",
    conversation_id: str = "",
) -> tuple[str, list[ProposeAction]]:
    """Extract structured ```action { ... } ``` proposals from the LLM reply and sanitize."""
    pattern = re.compile(r"```(?:action|json:action)\s*(\{.*?\})\s*```", re.DOTALL)
    if str(ai_policy or "").strip().upper() != "FULL":
        cleaned_reply = pattern.sub("", reply).strip()
        return cleaned_reply, []
    proposals: list[ProposeAction] = []

    for m in pattern.finditer(reply):
        raw_json = m.group(1).strip()
        try:
            data = json.loads(raw_json)
            action_name = data.get("actionName") or data.get("action")
            if action_name and is_action_allowed(action_name):
                action_def = get_action_definition(action_name)
                title = data.get("title") or (
                    action_def.description if action_def else action_name
                )
                desc = data.get("description") or (
                    action_def.description if action_def else ""
                )
                params = (
                    data.get("params") if isinstance(data.get("params"), dict) else {}
                )
                confirm_lbl = data.get("confirmLabel") or (
                    action_def.confirm_label if action_def else "Xác nhận"
                )
                cancel_lbl = data.get("cancelLabel") or (
                    action_def.cancel_label if action_def else "Hủy"
                )
                category = data.get("category") or (
                    action_def.category if action_def else "social"
                )
                is_destructive = (
                    data.get("isDestructive")
                    if "isDestructive" in data
                    else (action_def.is_destructive if action_def else False)
                )

                proposals.append(
                    _build_signed_proposal(
                        user_id=user_id,
                        conversation_id=conversation_id,
                        action_name=action_name,
                        title=title,
                        description=desc,
                        params=params,
                        confirm_label=confirm_lbl,
                        cancel_label=cancel_lbl,
                        category=category,
                        is_destructive=bool(is_destructive),
                    )
                )
        except Exception as exc:
            logger.warning("Failed to parse action proposal from LLM output: %s", exc)

    cleaned_reply = pattern.sub("", reply).strip()
    return cleaned_reply, proposals


EXPLICIT_ACTION_PHRASES: tuple[str, ...] = (
    "đọc hết thông báo",
    "đánh dấu đã đọc",
    "đánh dấu tất cả thông báo đã đọc",
    "mark all notifications",
    "đọc tất cả thông báo",
    "gửi lời mời kết bạn",
    "chấp nhận lời mời kết bạn",
    "từ chối lời mời kết bạn",
    "hủy kết bạn",
    "xóa bạn",
    "unfriend",
    "chặn tài khoản",
    "chặn người dùng",
    "rời nhóm",
    "tham gia nhóm",
)


GLOBAL_PROPOSABLE_ACTION_PHRASES: tuple[str, ...] = (
    "đọc hết thông báo",
    "đánh dấu đã đọc",
    "đánh dấu tất cả thông báo đã đọc",
    "mark all notifications",
    "đọc tất cả thông báo",
)


def is_global_proposable_action_request(message: str) -> bool:
    """Return True when the user requests a zero-ambiguity global action allowlisted for ProposeAction."""
    lowered = (message or "").lower()
    return any(kw in lowered for kw in GLOBAL_PROPOSABLE_ACTION_PHRASES)


_ACTION_FAQ_EXCLUSIONS: tuple[str, ...] = (
    "làm sao",
    "làm thế nào",
    "cách ",
    "hướng dẫn",
    "như thế nào",
    "ở đâu",
    "có nhận được",
    "có biết không",
    "có thông báo",
    "thì họ có",
    "thì người đó có",
    "thì có bị",
    "là gì",
)


def is_explicit_action_request(message: str) -> bool:
    """Return True when the user explicitly asks to execute an in-app action rather than navigate or ask FAQ."""
    lowered = (message or "").lower()
    if any(excl in lowered for excl in _ACTION_FAQ_EXCLUSIONS):
        return False
    return any(kw in lowered for kw in EXPLICIT_ACTION_PHRASES)


def detect_action_proposals(
    request: AssistantRespondRequest,
    tool_calls: tuple[Any, ...],
    tool_results: list[Any],
    *,
    conversation_id: str | None = None,
) -> list[ProposeAction]:
    """Synthesize zero-guesswork write action proposals for allowlisted global/account actions only.

    Entity-targeted Tier A actions (add friend, accept request, join group) are handled via
    Interactive Mini Cards with backend-bound IDs, and Tier B destructive actions are excluded
    from chat execution.
    """
    if str(getattr(request, "aiPolicy", "RESTRICTED") or "").strip().upper() != "FULL":
        return []

    resolved_user_id = request.userId
    resolved_conv_id = conversation_id or request.conversationId or ""
    msg = (request.message or "").lower()

    # Reject negative/refusal intents to avoid false-positive action proposals
    if any(
        neg in msg
        for neg in (
            "không muốn",
            "đừng",
            "chưa muốn",
            "không cần",
            "don't want",
            "do not",
        )
    ):
        return []

    if is_global_proposable_action_request(msg):
        action_def = get_action_definition("mark_all_notifications_read")
        if action_def:
            return [
                _build_signed_proposal(
                    user_id=resolved_user_id,
                    conversation_id=resolved_conv_id,
                    action_name="mark_all_notifications_read",
                    title="Đánh dấu đã đọc",
                    description="Đánh dấu toàn bộ thông báo của bạn là đã đọc",
                    params={},
                    confirm_label=action_def.confirm_label,
                    cancel_label=action_def.cancel_label,
                    category=action_def.category,
                    is_destructive=action_def.is_destructive,
                )
            ]

    return []


def build_proposal_from_meta_tool(
    args: dict[str, Any] | None,
    *,
    ai_policy: str = "RESTRICTED",
    user_id: str = "",
    conversation_id: str = "",
) -> tuple[ProposeAction | None, str]:
    """Validate and sign a ProposeAction emitted via the native `propose_account_action` tool."""
    if str(ai_policy or "").strip().upper() != "FULL":
        return (
            None,
            "Tài khoản đang ở chế độ bảo mật RESTRICTED nên không thể tạo đề xuất thao tác.",
        )
    if not isinstance(args, dict):
        return None, "Tham số đề xuất hành động không hợp lệ."

    action_name = str(args.get("action_name") or "").strip()
    if not is_action_allowed(action_name):
        return None, f"Hành động '{action_name}' không nằm trong danh mục được phép."

    action_def = get_action_definition(action_name)
    if action_def is None:
        return None, f"Không tìm thấy định nghĩa hành động '{action_name}'."

    raw_params = args.get("params")
    params = dict(raw_params) if isinstance(raw_params, dict) else {}
    missing = [p for p in action_def.required_params if not params.get(p)]
    if missing:
        return (
            None,
            f"Thiếu tham số bắt buộc ({', '.join(missing)}) để đề xuất hành động '{action_name}'.",
        )

    reason = str(args.get("reason") or "").strip() or action_def.description
    if action_def.is_destructive and "cảnh báo" not in reason.lower():
        description = f"{reason} (Lưu ý: thao tác này có thể ảnh hưởng trực tiếp tới dữ liệu hoặc quan hệ xã hội của bạn.)"
    else:
        description = reason

    proposal = _build_signed_proposal(
        user_id=user_id,
        conversation_id=conversation_id,
        action_name=action_name,
        title=action_def.confirm_label,
        description=description,
        params=params,
        confirm_label=action_def.confirm_label,
        cancel_label=action_def.cancel_label,
        category=action_def.category,
        is_destructive=action_def.is_destructive,
    )
    return (
        proposal,
        f"Đã tạo thẻ xác nhận cho hành động '{action_name}'. Hãy mời người dùng bấm xác nhận trên giao diện.",
    )
