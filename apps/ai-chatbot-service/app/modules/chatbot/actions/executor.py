from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from app.core.settings import settings
from app.modules.chatbot.actions.registry import ALLOWLISTED_ACTIONS, is_action_allowed
from app.modules.chatbot.schemas import ActionExecutionRequest, ActionExecutionResponse
from app.modules.chatbot.tools.http_client import GatewayHttpClient, gateway_http_client

logger = logging.getLogger("uvicorn.error")

IDEMPOTENCY_TTL_SECONDS = 900  # 15 minutes


class ActionExecutorService:
    """Safely executes confirmed write actions against downstream microservices with replay protection."""

    def __init__(
        self,
        http_client: GatewayHttpClient | None = None,
        redis_client=None,
        enable_mock: bool | None = None,
    ):
        self.http_client = http_client or gateway_http_client
        self._redis = redis_client
        self._enable_mock = enable_mock
        self._redis_unavailable_logged = False
        self._redis_disabled_until: float = 0.0
        # In-memory LRU/dict fallback when Redis is offline
        self._local_cache: dict[str, tuple[float, ActionExecutionResponse]] = {}
        self._inflight_locks: dict[str, asyncio.Lock] = {}

    @property
    def mock_fallbacks_enabled(self) -> bool:
        if self._enable_mock is not None:
            return self._enable_mock
        return settings.TOOL_ENABLE_MOCK_FALLBACKS

    def _get_lock_for_key(self, key: str) -> asyncio.Lock:
        if key not in self._inflight_locks:
            self._inflight_locks[key] = asyncio.Lock()
        return self._inflight_locks[key]

    async def execute(
        self,
        request: ActionExecutionRequest,
        auth_token: str | None = None,
        user_id: str | None = None,
    ) -> ActionExecutionResponse:
        effective_token = auth_token or request.authToken
        effective_user_id = user_id or request.userId

        # 1. Allowlist verification
        if not is_action_allowed(request.actionName):
            return ActionExecutionResponse(
                success=False,
                actionName=request.actionName,
                message=f"Hành động '{request.actionName}' không nằm trong danh mục được phép thực thi.",
                error="ACTION_NOT_ALLOWLISTED",
            )

        # 2. Synchronize concurrent requests on the same idempotencyKey
        key = request.idempotencyKey
        lock = self._get_lock_for_key(key) if key else None

        if lock:
            try:
                async with lock:
                    return await self._execute_internal(request, effective_token, effective_user_id)
            finally:
                self._inflight_locks.pop(key, None)
        return await self._execute_internal(request, effective_token, effective_user_id)

    async def _execute_internal(
        self,
        request: ActionExecutionRequest,
        effective_token: str | None,
        effective_user_id: str | None,
    ) -> ActionExecutionResponse:
        # Idempotency check
        cached_result = await self._get_idempotent_result(request.idempotencyKey)
        if cached_result is not None:
            logger.info("Idempotent replay detected for key: %s", request.idempotencyKey)
            return cached_result

        # Parameter extraction and normalization
        params = request.params or {}
        action_name = request.actionName

        try:
            result = await self._dispatch_mutation(action_name, params, effective_token, effective_user_id)
            # Only cache successful executions in idempotency store so transient errors can be retried
            if result.success:
                await self._set_idempotent_result(request.idempotencyKey, result)
            return result
        except Exception as exc:
            logger.exception("Action execution failed: %s", exc)
            return ActionExecutionResponse(
                success=False,
                actionName=action_name,
                message="Có lỗi xảy ra khi thực hiện hành động. Vui lòng thử lại sau.",
                error=str(exc),
            )

    async def _dispatch_mutation(
        self,
        action_name: str,
        params: dict[str, Any],
        auth_token: str | None,
        user_id: str | None,
    ) -> ActionExecutionResponse:
        # Mock mode check
        if self.mock_fallbacks_enabled:
            return self._build_mock_success(action_name, params)

        if action_name == "send_friend_request":
            target_id = params.get("target_user_id") or params.get("targetUserId") or params.get("id")
            if not target_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã người dùng (target_user_id).", error="MISSING_PARAM"
                )
            res = await self.http_client.post(f"/social/request/{target_id}", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể gửi lời mời kết bạn."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã gửi lời mời kết bạn thành công!", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "accept_friend_request":
            requester_id = params.get("requester_id") or params.get("requesterId") or params.get("id")
            if not requester_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã người yêu cầu (requester_id).", error="MISSING_PARAM"
                )
            res = await self.http_client.post(f"/social/accept/{requester_id}", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể chấp nhận kết bạn."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã chấp nhận lời mời kết bạn thành công!", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "cancel_friend_request":
            target_id = params.get("target_user_id") or params.get("targetUserId") or params.get("id")
            if not target_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã người dùng (target_user_id).", error="MISSING_PARAM"
                )
            res = await self.http_client.post(f"/social/cancel/{target_id}", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể thu hồi lời mời."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã thu hồi lời mời kết bạn thành công!", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "join_group":
            group_id = params.get("group_id") or params.get("groupId")
            if not group_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã nhóm (group_id).", error="MISSING_PARAM"
                )
            res = await self.http_client.post(f"/groups/{group_id}/join-requests", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể tham gia nhóm."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã gửi yêu cầu tham gia nhóm thành công!", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "leave_group":
            group_id = params.get("group_id") or params.get("groupId")
            if not group_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã nhóm (group_id).", error="MISSING_PARAM"
                )
            res = await self.http_client.post(f"/groups/{group_id}/members/leave", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể rời nhóm."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã rời khỏi nhóm thành công.", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "decline_friend_request":
            requester_id = params.get("requester_id") or params.get("requesterId") or params.get("id")
            if not requester_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã người yêu cầu (requester_id).", error="MISSING_PARAM"
                )
            res = await self.http_client.post(f"/social/decline/{requester_id}", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể từ chối lời mời kết bạn."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã từ chối lời mời kết bạn.", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "unfriend_user":
            target_id = params.get("target_user_id") or params.get("targetUserId") or params.get("friendId") or params.get("id")
            if not target_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã bạn bè (target_user_id).", error="MISSING_PARAM"
                )
            res = await self.http_client.post(f"/social/remove/{target_id}", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể hủy kết bạn."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã hủy kết bạn thành công.", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "block_user":
            target_id = params.get("target_user_id") or params.get("targetUserId") or params.get("id")
            if not target_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã người dùng (target_user_id).", error="MISSING_PARAM"
                )
            res = await self.http_client.post(f"/social/block/{target_id}", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể chặn người dùng."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã chặn người dùng thành công.", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "react_post":
            post_id = params.get("post_id") or params.get("postId") or params.get("targetId") or params.get("id")
            if not post_id:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message="Thiếu mã bài viết (post_id).", error="MISSING_PARAM"
                )
            raw_reaction = str(params.get("reaction_type") or params.get("reactionType") or "LIKE").upper()
            valid_reactions = {"LIKE", "LOVE", "HAHA", "WOW", "SAD", "ANGRY"}
            reaction_type = raw_reaction if raw_reaction in valid_reactions else "LIKE"
            res = await self.http_client.post(
                "/reactions",
                json_body={
                    "targetId": post_id,
                    "targetType": "POST",
                    "reactionType": reaction_type,
                },
                auth_token=auth_token,
            )
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể thả cảm xúc."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message=f"Đã thả cảm xúc '{reaction_type.lower()}' cho bài viết!", data=res if isinstance(res, dict) else {}
            )

        elif action_name == "mark_all_notifications_read":
            res = await self.http_client.patch("/notifications/read-all", json_body={}, auth_token=auth_token)
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False, actionName=action_name, message=res.get("message", "Không thể cập nhật thông báo."), error=res.get("error")
                )
            return ActionExecutionResponse(
                success=True, actionName=action_name, message="Đã đánh dấu tất cả thông báo là đã đọc!", data=res if isinstance(res, dict) else {}
            )

        return ActionExecutionResponse(
            success=False, actionName=action_name, message="Hành động chưa được cấu hình xử lý.", error="UNIMPLEMENTED"
        )

    def _build_mock_success(self, action_name: str, params: dict[str, Any]) -> ActionExecutionResponse:
        messages = {
            "send_friend_request": "Đã gửi lời mời kết bạn thành công (Chế độ mô phỏng).",
            "accept_friend_request": "Đã chấp nhận lời mời kết bạn (Chế độ mô phỏng).",
            "decline_friend_request": "Đã từ chối lời mời kết bạn (Chế độ mô phỏng).",
            "cancel_friend_request": "Đã thu hồi lời mời kết bạn (Chế độ mô phỏng).",
            "unfriend_user": "Đã hủy kết bạn thành công (Chế độ mô phỏng).",
            "block_user": "Đã chặn người dùng thành công (Chế độ mô phỏng).",
            "join_group": "Đã gửi yêu cầu tham gia nhóm (Chế độ mô phỏng).",
            "leave_group": "Đã rời nhóm thành công (Chế độ mô phỏng).",
            "react_post": "Đã thả cảm xúc cho bài viết (Chế độ mô phỏng).",
            "mark_all_notifications_read": "Đã đánh dấu đã đọc tất cả thông báo (Chế độ mô phỏng).",
        }
        return ActionExecutionResponse(
            success=True,
            actionName=action_name,
            message=messages.get(action_name, "Thao tác thành công."),
            data={"mock": True, "params": params},
        )

    async def _get_idempotent_result(self, key: str) -> ActionExecutionResponse | None:
        if not key:
            return None

        # Check local cache first
        now = time.time()
        if key in self._local_cache:
            exp, cached_resp = self._local_cache[key]
            if now < exp:
                return cached_resp
            del self._local_cache[key]

        redis = await self._get_redis()
        if redis:
            try:
                raw = await redis.get(f"chatbot:action_idempotency:{key}")
                if raw:
                    data = json.loads(raw)
                    return ActionExecutionResponse(**data)
            except Exception as exc:
                self._disable_redis(exc)
        return None

    async def _set_idempotent_result(self, key: str, result: ActionExecutionResponse) -> None:
        if not key:
            return

        now = time.time()
        self._local_cache[key] = (now + IDEMPOTENCY_TTL_SECONDS, result)

        # Cleanup old local items if exceeding 200 items
        if len(self._local_cache) > 200:
            expired_keys = [k for k, (exp, _) in self._local_cache.items() if now >= exp]
            for k in expired_keys:
                del self._local_cache[k]

        redis = await self._get_redis()
        if redis:
            try:
                await redis.setex(
                    f"chatbot:action_idempotency:{key}",
                    IDEMPOTENCY_TTL_SECONDS,
                    result.model_dump_json(),
                )
            except Exception as exc:
                self._disable_redis(exc)

    async def _get_redis(self):
        if self._redis is not None and self._redis is not False:
            return self._redis
        if self._redis is False:
            if time.time() < self._redis_disabled_until:
                return None
            self._redis = None

        try:
            from redis.asyncio import Redis

            self._redis = Redis.from_url(
                settings.CHATBOT_REDIS_URL,
                decode_responses=True,
            )
            await self._redis.ping()
            return self._redis
        except Exception as exc:
            self._disable_redis(exc)
            return None

    def _disable_redis(self, exc: Exception):
        self._redis = False
        self._redis_disabled_until = time.time() + settings.CHATBOT_REDIS_RECONNECT_BACKOFF_SECONDS
        if not self._redis_unavailable_logged:
            logger.warning("[ActionExecutor] Redis unavailable for idempotency, falling back to in-memory: %s", exc)
            self._redis_unavailable_logged = True


action_executor_service = ActionExecutorService()
