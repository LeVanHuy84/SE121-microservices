from __future__ import annotations

import json
import logging
import re
from typing import Any
from uuid import uuid4

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


def extract_cards(
    tool_calls: tuple[Any, ...],
    tool_results: list[Any],
) -> list[ShowCardAction]:
    """Extract interactive UI cards from read tool execution results."""
    cards: list[ShowCardAction] = []
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
                    username_or_id = (
                        u.get("username")
                        or u.get("id")
                        or u.get("targetUserId")
                        or ""
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
                                    "userId": u.get("id"),
                                    "username": u.get("username"),
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
                        f"{m_count} thành viên"
                        if m_count
                        else "Cộng đồng Sentimeta"
                    )
                    g_id = g.get("id") or g.get("groupId") or ""
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
                                metadata={"groupId": g_id},
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
                        (p_content[:75] + "...")
                        if len(p_content) > 75
                        else p_content
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
    ai_policy: str = "FULL",
) -> tuple[str, list[ProposeAction]]:
    """Extract structured ```action { ... } ``` proposals from the LLM reply and sanitize."""
    pattern = re.compile(r"```(?:action|json:action)\s*(\{.*?\})\s*```", re.DOTALL)
    if ai_policy and str(ai_policy).upper() == "RESTRICTED":
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
                    ProposeAction(
                        label=confirm_lbl,
                        payload=ProposeActionPayload(
                            actionName=action_name,
                            title=title,
                            description=desc,
                            params=params,
                            idempotencyKey=str(uuid4()),
                            confirmLabel=confirm_lbl,
                            cancelLabel=cancel_lbl,
                            category=category,
                            isDestructive=is_destructive,
                        ),
                    )
                )
        except Exception as exc:
            logger.warning(
                "Failed to parse action proposal from LLM output: %s", exc
            )

    cleaned_reply = pattern.sub("", reply).strip()
    return cleaned_reply, proposals


def detect_action_proposals(
    request: AssistantRespondRequest,
    tool_calls: tuple[Any, ...],
    tool_results: list[Any],
) -> list[ProposeAction]:
    """Synthesize write action proposals based on user intent, surface context, and tool results."""
    if (
        getattr(request, "aiPolicy", "FULL")
        and str(request.aiPolicy).upper() == "RESTRICTED"
    ):
        return []

    proposals: list[ProposeAction] = []
    msg = (request.message or "").lower()

    # Reject negative/refusal intents to avoid false-positive action proposals
    # e.g., "Tôi không muốn kết bạn", "Đừng gửi lời mời", "Chưa muốn vào nhóm"
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

    # 1. Mark all notifications as read
    if any(
        kw in msg
        for kw in (
            "đọc hết thông báo",
            "đánh dấu đã đọc",
            "mark all notifications",
            "đọc tất cả thông báo",
        )
    ):
        action_def = get_action_definition("mark_all_notifications_read")
        if action_def:
            proposals.append(
                ProposeAction(
                    label=action_def.confirm_label,
                    payload=ProposeActionPayload(
                        actionName="mark_all_notifications_read",
                        title="Đánh dấu đã đọc",
                        description="Đánh dấu toàn bộ thông báo của bạn là đã đọc",
                        params={},
                        idempotencyKey=str(uuid4()),
                        confirmLabel=action_def.confirm_label,
                        cancelLabel=action_def.cancel_label,
                        category=action_def.category,
                        isDestructive=action_def.is_destructive,
                    ),
                )
            )

    # 2. Friend interactions (send / accept / decline / cancel / unfriend)
    if any(
        kw in msg
        for kw in (
            "kết bạn",
            "gửi kết bạn",
            "add friend",
            "lời mời kết bạn",
            "chấp nhận",
            "đồng ý",
            "thu hồi",
            "hủy",
            "từ chối",
            "bỏ qua",
            "decline",
            "unfriend",
            "xóa bạn",
        )
    ):
        # Check decline friend request
        if any(kw in msg for kw in ("từ chối", "bỏ qua", "decline", "reject")):
            requester_id = None
            requester_name = "người dùng"
            for tc, res in zip(tool_calls, tool_results):
                if getattr(tc, "name", "") == "get_my_friend_requests" and getattr(
                    res, "success", False
                ):
                    reqs = (
                        res.data.get("requests", [])
                        if isinstance(res.data, dict)
                        else res.data
                    )
                    if isinstance(reqs, list) and reqs:
                        first_req = reqs[0]
                        requester_id = (
                            first_req.get("senderId")
                            or first_req.get("requesterId")
                            or first_req.get("id")
                        )
                        requester_name = (
                            first_req.get("senderName")
                            or first_req.get("name")
                            or "người dùng"
                        )
                        break
            if (
                not requester_id
                and request.surface
                and request.surface.entityId
                and "profile" in (request.surface.screen or "")
            ):
                requester_id = request.surface.entityId
                requester_name = (request.surface.metadata or {}).get(
                    "userName"
                ) or "người dùng"
            if requester_id:
                action_def = get_action_definition("decline_friend_request")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="decline_friend_request",
                                title="Từ chối kết bạn",
                                description=f"Từ chối lời mời kết bạn từ {requester_name}",
                                params={"requester_id": requester_id},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )
        # Check accept
        elif any(kw in msg for kw in ("đồng ý", "chấp nhận", "accept")):
            requester_id = None
            requester_name = "người dùng"
            for tc, res in zip(tool_calls, tool_results):
                if getattr(tc, "name", "") == "get_my_friend_requests" and getattr(
                    res, "success", False
                ):
                    reqs = (
                        res.data.get("requests", [])
                        if isinstance(res.data, dict)
                        else res.data
                    )
                    if isinstance(reqs, list) and reqs:
                        first_req = reqs[0]
                        requester_id = (
                            first_req.get("senderId")
                            or first_req.get("requesterId")
                            or first_req.get("id")
                        )
                        requester_name = (
                            first_req.get("senderName")
                            or first_req.get("name")
                            or "người dùng"
                        )
                        break
            if requester_id:
                action_def = get_action_definition("accept_friend_request")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="accept_friend_request",
                                title="Đồng ý kết bạn",
                                description=f"Chấp nhận lời mời kết bạn từ {requester_name}",
                                params={"requester_id": requester_id},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )
        # Check unfriend
        elif any(kw in msg for kw in ("hủy kết bạn", "xóa bạn", "unfriend")):
            target_user_id = (
                request.surface.entityId
                if (request.surface and "profile" in (request.surface.screen or ""))
                else None
            )
            target_name = (
                (request.surface.metadata or {}).get("userName") or "người dùng"
                if request.surface
                else "người dùng"
            )
            if not target_user_id:
                for tc, res in zip(tool_calls, tool_results):
                    if getattr(tc, "name", "") in (
                        "search_users",
                        "get_user_friends",
                    ) and getattr(res, "success", False):
                        users = (
                            res.data.get("users", [])
                            if isinstance(res.data, dict)
                            else (
                                res.data.get("friends", [])
                                if isinstance(res.data, dict)
                                else res.data
                            )
                        )
                        if isinstance(users, list) and users:
                            first_u = users[0]
                            target_user_id = first_u.get("id") or first_u.get("userId")
                            target_name = (
                                first_u.get("name")
                                or first_u.get("username")
                                or "người dùng"
                            )
                            break
            if target_user_id:
                action_def = get_action_definition("unfriend_user")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="unfriend_user",
                                title=f"Hủy kết bạn với {target_name}",
                                description=f"Hủy quan hệ bạn bè với {target_name}",
                                params={"target_user_id": target_user_id},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )
        # Check cancel friend request
        elif any(kw in msg for kw in ("hủy", "thu hồi", "cancel")):
            target_user_id = (
                request.surface.entityId
                if (request.surface and "profile" in (request.surface.screen or ""))
                else None
            )
            if target_user_id:
                action_def = get_action_definition("cancel_friend_request")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="cancel_friend_request",
                                title="Thu hồi lời mời",
                                description="Thu hồi lời mời kết bạn đã gửi",
                                params={"target_user_id": target_user_id},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )
        # Send friend request
        elif any(kw in msg for kw in ("kết bạn", "gửi kết bạn", "add friend")):
            target_user_id = None
            target_name = "người dùng"
            for tc, res in zip(tool_calls, tool_results):
                if getattr(tc, "name", "") in (
                    "search_users",
                    "get_friend_recommendations",
                ) and getattr(res, "success", False):
                    users = (
                        res.data.get("users", [])
                        if isinstance(res.data, dict)
                        else res.data
                    )
                    if isinstance(users, list) and users:
                        first_u = users[0]
                        target_user_id = first_u.get("id") or first_u.get("userId")
                        target_name = (
                            first_u.get("name")
                            or first_u.get("username")
                            or "người dùng"
                        )
                        break

            if (
                not target_user_id
                and request.surface
                and request.surface.entityId
                and "profile" in (request.surface.screen or "")
            ):
                target_user_id = request.surface.entityId
                target_name = (request.surface.metadata or {}).get(
                    "userName"
                ) or "người dùng"

            if target_user_id:
                action_def = get_action_definition("send_friend_request")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="send_friend_request",
                                title=f"Gửi kết bạn tới {target_name}",
                                description=f"Gửi lời mời kết bạn tới {target_name}",
                                params={"target_user_id": target_user_id},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )

    # 3. Block user
    if any(kw in msg for kw in ("chặn", "block")):
        target_user_id = (
            request.surface.entityId
            if (request.surface and "profile" in (request.surface.screen or ""))
            else None
        )
        target_name = (
            (request.surface.metadata or {}).get("userName") or "người này"
            if request.surface
            else "người này"
        )
        if not target_user_id:
            for tc, res in zip(tool_calls, tool_results):
                if getattr(tc, "name", "") in ("search_users",) and getattr(
                    res, "success", False
                ):
                    users = (
                        res.data.get("users", [])
                        if isinstance(res.data, dict)
                        else res.data
                    )
                    if isinstance(users, list) and users:
                        first_u = users[0]
                        target_user_id = first_u.get("id") or first_u.get("userId")
                        target_name = (
                            first_u.get("name")
                            or first_u.get("username")
                            or "người này"
                        )
                        break
        if target_user_id:
            action_def = get_action_definition("block_user")
            if action_def:
                proposals.append(
                    ProposeAction(
                        label=action_def.confirm_label,
                        payload=ProposeActionPayload(
                            actionName="block_user",
                            title=f"Chặn người dùng {target_name}",
                            description=f"Chặn {target_name} để dừng mọi liên lạc và tương tác",
                            params={"target_user_id": target_user_id},
                            idempotencyKey=str(uuid4()),
                            confirmLabel=action_def.confirm_label,
                            cancelLabel=action_def.cancel_label,
                            category=action_def.category,
                            isDestructive=action_def.is_destructive,
                        ),
                    )
                )

    # 4. Community Group interactions (join / leave)
    if any(kw in msg for kw in ("nhóm", "group")):
        if any(kw in msg for kw in ("tham gia", "vào nhóm", "join")):
            group_id = None
            group_name = "nhóm"
            for tc, res in zip(tool_calls, tool_results):
                if getattr(tc, "name", "") == "search_groups" and getattr(
                    res, "success", False
                ):
                    groups = (
                        res.data.get("groups", [])
                        if isinstance(res.data, dict)
                        else res.data
                    )
                    if isinstance(groups, list) and groups:
                        first_g = groups[0]
                        group_id = first_g.get("id") or first_g.get("groupId")
                        group_name = first_g.get("name") or "nhóm"
                        break
            if (
                not group_id
                and request.surface
                and request.surface.entityId
                and "group" in (request.surface.screen or "")
            ):
                group_id = request.surface.entityId
                group_name = (request.surface.metadata or {}).get(
                    "groupName"
                ) or "nhóm này"

            if group_id:
                action_def = get_action_definition("join_group")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="join_group",
                                title=f"Tham gia nhóm {group_name}",
                                description=f"Gửi yêu cầu hoặc tham gia nhóm {group_name}",
                                params={"group_id": group_id},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )
        elif any(kw in msg for kw in ("rời", "thoát", "leave")):
            group_id = (
                request.surface.entityId
                if (request.surface and "group" in (request.surface.screen or ""))
                else None
            )
            group_name = (
                (request.surface.metadata or {}).get("groupName", "nhóm")
                if request.surface
                else "nhóm"
            )
            if group_id:
                action_def = get_action_definition("leave_group")
                if action_def:
                    proposals.append(
                        ProposeAction(
                            label=action_def.confirm_label,
                            payload=ProposeActionPayload(
                                actionName="leave_group",
                                title=f"Rời nhóm {group_name}",
                                description=f"Rời khỏi nhóm {group_name}",
                                params={"group_id": group_id},
                                idempotencyKey=str(uuid4()),
                                confirmLabel=action_def.confirm_label,
                                cancelLabel=action_def.cancel_label,
                                category=action_def.category,
                                isDestructive=action_def.is_destructive,
                            ),
                        )
                    )

    # 5. Post Reaction interactions
    if any(
        kw in msg
        for kw in ("thích", "thả tim", "like bài", "bài viết này", "react")
    ):
        post_id = None
        if request.surface and "post" in (request.surface.screen or ""):
            post_id = request.surface.entityId
        if not post_id:
            for tc, res in zip(tool_calls, tool_results):
                if getattr(tc, "name", "") in (
                    "get_trending_posts",
                    "get_my_posts_overview",
                ) and getattr(res, "success", False):
                    posts = (
                        res.data.get("posts", [])
                        if isinstance(res.data, dict)
                        else res.data
                    )
                    if isinstance(posts, list) and posts:
                        first_p = posts[0]
                        post_id = first_p.get("id") or first_p.get("postId")
                        break
        if post_id:
            rxn = "love" if any(w in msg for w in ("tim", "love")) else "like"
            action_def = get_action_definition("react_post")
            if action_def:
                proposals.append(
                    ProposeAction(
                        label=action_def.confirm_label,
                        payload=ProposeActionPayload(
                            actionName="react_post",
                            title=f"Thả cảm xúc ({rxn})",
                            description=f"Bày tỏ cảm xúc '{rxn}' cho bài viết",
                            params={"post_id": post_id, "reaction_type": rxn},
                            idempotencyKey=str(uuid4()),
                            confirmLabel=action_def.confirm_label,
                            cancelLabel=action_def.cancel_label,
                            category=action_def.category,
                            isDestructive=action_def.is_destructive,
                        ),
                    )
                )

    # Deduplicate proposals by (actionName, str(params))
    seen = set()
    deduped = []
    for p in proposals:
        key = (p.payload.actionName, json.dumps(p.payload.params, sort_keys=True))
        if key not in seen:
            seen.add(key)
            deduped.append(p)
    return deduped[:2]
