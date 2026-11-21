from __future__ import annotations

import json
import logging
import re
import time
from typing import Any
from uuid import uuid4

from app.core.settings import settings
from app.modules.chatbot.actions.audit import ActionAuditLogger, action_audit_logger
from app.modules.chatbot.actions.registry import is_action_allowed
from app.modules.chatbot.schemas import ActionExecutionRequest, ActionExecutionResponse
from app.modules.chatbot.services.assistant_support.proposals import (
    compute_params_hash,
    verify_proposal_token,
)
from app.modules.chatbot.tools.http_client import GatewayHttpClient, gateway_http_client

logger = logging.getLogger("uvicorn.error")

IDEMPOTENCY_TTL_SECONDS = max(900, settings.PROPOSAL_TOKEN_TTL_SECONDS)
INFLIGHT_LEASE_SECONDS = 30
_ENTITY_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,128}$")
_PATH_PARAM_KEYS = (
    "target_user_id",
    "targetUserId",
    "id",
    "requester_id",
    "requesterId",
    "group_id",
    "groupId",
)
_DETERMINISTIC_DENIAL_ERRORS = frozenset(
    {"MISSING_PARAM", "INVALID_PARAM", "UNIMPLEMENTED"}
)
_LUA_RELEASE_LEASE = """
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
"""


class ActionExecutorService:
    """Safely executes confirmed write actions against downstream microservices with replay protection."""

    def __init__(
        self,
        http_client: GatewayHttpClient | None = None,
        redis_client=None,
        enable_mock: bool | None = None,
        audit_logger: ActionAuditLogger | None = None,
    ):
        self.http_client = http_client or gateway_http_client
        self._redis = redis_client
        self._enable_mock = enable_mock
        self._audit = audit_logger or action_audit_logger
        self._redis_unavailable_logged = False
        self._redis_disabled_until: float = 0.0

    @property
    def mock_fallbacks_enabled(self) -> bool:
        if self._enable_mock is not None:
            return self._enable_mock
        return settings.TOOL_ENABLE_MOCK_FALLBACKS

    async def _emit_audit(
        self,
        *,
        user_id: str,
        request: ActionExecutionRequest,
        params_hash: str,
        ai_policy: str,
        status: str,
        error_code: str | None,
        started_at: float,
    ) -> None:
        await self._audit.record(
            user_id=user_id,
            conversation_id=request.conversationId,
            action_id=request.actionId,
            action_name=request.actionName,
            idempotency_key=request.idempotencyKey,
            params_hash=params_hash,
            ai_policy=ai_policy,
            status=status,
            error_code=error_code,
            latency_ms=(time.perf_counter() - started_at) * 1000,
        )

    async def execute(
        self,
        request: ActionExecutionRequest,
        auth_token: str | None = None,
        user_id: str | None = None,
    ) -> ActionExecutionResponse:
        started_at = time.perf_counter()
        effective_token = auth_token or request.authToken
        effective_user_id = user_id or request.userId or ""
        effective_policy = str(
            getattr(request, "aiPolicy", "RESTRICTED") or "RESTRICTED"
        ).upper()
        params = request.params or {}
        params_hash = compute_params_hash(params)

        # -1. Production Mock Guard
        if settings.APP_ENV == "production" and self.mock_fallbacks_enabled:
            await self._emit_audit(
                user_id=effective_user_id,
                request=request,
                params_hash=params_hash,
                ai_policy=effective_policy,
                status="failed",
                error_code="MOCK_FALLBACK_FORBIDDEN_IN_PROD",
                started_at=started_at,
            )
            return ActionExecutionResponse(
                success=False,
                actionName=request.actionName,
                message="Chế độ mô phỏng không được phép bật trong môi trường production.",
                error="MOCK_FALLBACK_FORBIDDEN_IN_PROD",
            )

        # 0. Privacy Policy Gate verification (Defense-in-depth, fail-closed)
        if effective_policy != "FULL":
            await self._emit_audit(
                user_id=effective_user_id,
                request=request,
                params_hash=params_hash,
                ai_policy=effective_policy,
                status="denied",
                error_code="AI_POLICY_RESTRICTED",
                started_at=started_at,
            )
            return ActionExecutionResponse(
                success=False,
                actionName=request.actionName,
                message="Tài khoản của bạn đang bật chế độ bảo mật nghiêm ngặt. Trợ lý AI không được phép thực hiện thao tác tài khoản.",
                error="AI_POLICY_RESTRICTED",
            )

        # 1. Allowlist verification
        if not is_action_allowed(request.actionName):
            await self._emit_audit(
                user_id=effective_user_id,
                request=request,
                params_hash=params_hash,
                ai_policy=effective_policy,
                status="denied",
                error_code="ACTION_NOT_ALLOWLISTED",
                started_at=started_at,
            )
            return ActionExecutionResponse(
                success=False,
                actionName=request.actionName,
                message=f"Hành động '{request.actionName}' không nằm trong danh mục được phép thực thi.",
                error="ACTION_NOT_ALLOWLISTED",
            )

        # 2. Proposal Capability Token verification
        token_ok, token_err = verify_proposal_token(
            token=request.proposalToken,
            user_id=effective_user_id,
            conversation_id=request.conversationId,
            action_id=request.actionId,
            action_name=request.actionName,
            params=params,
            idempotency_key=request.idempotencyKey,
        )
        if not token_ok:
            err_code = token_err or "PROPOSAL_TOKEN_INVALID"
            await self._emit_audit(
                user_id=effective_user_id,
                request=request,
                params_hash=params_hash,
                ai_policy=effective_policy,
                status="denied",
                error_code=err_code,
                started_at=started_at,
            )
            msg = (
                "Đề xuất thao tác đã hết hạn. Vui lòng yêu cầu trợ lý tạo đề xuất mới."
                if err_code == "PROPOSAL_TOKEN_EXPIRED"
                else "Mã xác thực đề xuất thao tác không hợp lệ."
            )
            return ActionExecutionResponse(
                success=False,
                actionName=request.actionName,
                message=msg,
                error=err_code,
            )

        # 3. Distributed Redis Idempotency (Fail-Closed)
        return await self._execute_internal(
            request=request,
            effective_token=effective_token,
            effective_user_id=effective_user_id,
            effective_policy=effective_policy,
            params_hash=params_hash,
            started_at=started_at,
        )

    async def _execute_internal(
        self,
        request: ActionExecutionRequest,
        effective_token: str | None,
        effective_user_id: str,
        effective_policy: str,
        params_hash: str,
        started_at: float,
    ) -> ActionExecutionResponse:
        idem_key = f"chatbot:action:idem:{effective_user_id}:{request.idempotencyKey}"
        redis = await self._get_redis()
        if redis is None:
            await self._emit_audit(
                user_id=effective_user_id,
                request=request,
                params_hash=params_hash,
                ai_policy=effective_policy,
                status="failed",
                error_code="ACTION_IDEMPOTENCY_UNAVAILABLE",
                started_at=started_at,
            )
            return ActionExecutionResponse(
                success=False,
                actionName=request.actionName,
                message="Dịch vụ khóa thao tác tạm thời không khả dụng.",
                error="ACTION_IDEMPOTENCY_UNAVAILABLE",
            )

        attempt_id = str(uuid4())
        inflight_payload = json.dumps(
            {"status": "inflight", "attemptId": attempt_id},
            separators=(",", ":"),
        )

        try:
            existing_raw = await redis.get(idem_key)
            if existing_raw:
                parsed = json.loads(existing_raw)
                if parsed.get("status") == "inflight":
                    await self._emit_audit(
                        user_id=effective_user_id,
                        request=request,
                        params_hash=params_hash,
                        ai_policy=effective_policy,
                        status="denied",
                        error_code="ACTION_IN_PROGRESS",
                        started_at=started_at,
                    )
                    return ActionExecutionResponse(
                        success=False,
                        actionName=request.actionName,
                        message="Thao tác đang được xử lý, vui lòng đợi.",
                        error="ACTION_IN_PROGRESS",
                    )
                await self._emit_audit(
                    user_id=effective_user_id,
                    request=request,
                    params_hash=params_hash,
                    ai_policy=effective_policy,
                    status="replayed",
                    error_code=parsed.get("error"),
                    started_at=started_at,
                )
                return ActionExecutionResponse(**parsed)

            acquired = await redis.set(
                idem_key, inflight_payload, nx=True, ex=INFLIGHT_LEASE_SECONDS
            )
            if not acquired:
                re_read_raw = await redis.get(idem_key)
                if re_read_raw:
                    parsed = json.loads(re_read_raw)
                    if parsed.get("status") != "inflight":
                        await self._emit_audit(
                            user_id=effective_user_id,
                            request=request,
                            params_hash=params_hash,
                            ai_policy=effective_policy,
                            status="replayed",
                            error_code=parsed.get("error"),
                            started_at=started_at,
                        )
                        return ActionExecutionResponse(**parsed)
                await self._emit_audit(
                    user_id=effective_user_id,
                    request=request,
                    params_hash=params_hash,
                    ai_policy=effective_policy,
                    status="denied",
                    error_code="ACTION_IN_PROGRESS",
                    started_at=started_at,
                )
                return ActionExecutionResponse(
                    success=False,
                    actionName=request.actionName,
                    message="Thao tác đang được xử lý, vui lòng đợi.",
                    error="ACTION_IN_PROGRESS",
                )
        except Exception as exc:
            self._disable_redis(exc)
            await self._emit_audit(
                user_id=effective_user_id,
                request=request,
                params_hash=params_hash,
                ai_policy=effective_policy,
                status="failed",
                error_code="ACTION_IDEMPOTENCY_UNAVAILABLE",
                started_at=started_at,
            )
            return ActionExecutionResponse(
                success=False,
                actionName=request.actionName,
                message="Dịch vụ khóa thao tác tạm thời không khả dụng.",
                error="ACTION_IDEMPOTENCY_UNAVAILABLE",
            )

        params = request.params or {}
        action_name = request.actionName

        try:
            result = await self._dispatch_mutation(
                action_name, params, effective_token, effective_user_id
            )
            is_terminal = result.success or (
                result.error in _DETERMINISTIC_DENIAL_ERRORS
            )
            if is_terminal:
                await self._store_terminal_result(redis, idem_key, result)
            else:
                await self._release_inflight_lease(redis, idem_key, inflight_payload)

            await self._emit_audit(
                user_id=effective_user_id,
                request=request,
                params_hash=params_hash,
                ai_policy=effective_policy,
                status="succeeded"
                if result.success
                else (
                    "denied"
                    if result.error in _DETERMINISTIC_DENIAL_ERRORS
                    else "failed"
                ),
                error_code=result.error,
                started_at=started_at,
            )
            return result
        except Exception as exc:
            logger.exception("Action execution failed: %s", exc)
            await self._release_inflight_lease(redis, idem_key, inflight_payload)
            await self._emit_audit(
                user_id=effective_user_id,
                request=request,
                params_hash=params_hash,
                ai_policy=effective_policy,
                status="failed",
                error_code=type(exc).__name__,
                started_at=started_at,
            )
            return ActionExecutionResponse(
                success=False,
                actionName=action_name,
                message="Có lỗi xảy ra khi thực hiện hành động. Vui lòng thử lại sau.",
                error="ACTION_EXECUTION_FAILED",
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

        for key in _PATH_PARAM_KEYS:
            val = params.get(key)
            if val is not None and val != "" and not _ENTITY_ID_PATTERN.match(str(val)):
                return ActionExecutionResponse(
                    success=False,
                    actionName=action_name,
                    message=f"Tham số '{key}' không hợp lệ.",
                    error="INVALID_PARAM",
                )

        if action_name == "mark_all_notifications_read":
            res = await self.http_client.patch(
                "/notifications/read-all", json_body={}, auth_token=auth_token
            )
            if isinstance(res, dict) and "_error" in res:
                return ActionExecutionResponse(
                    success=False,
                    actionName=action_name,
                    message=res.get("message", "Không thể cập nhật thông báo."),
                    error=res.get("error"),
                )
            return ActionExecutionResponse(
                success=True,
                actionName=action_name,
                message="Đã đánh dấu tất cả thông báo là đã đọc!",
                data=res if isinstance(res, dict) else {},
            )

        return ActionExecutionResponse(
            success=False,
            actionName=action_name,
            message="Hành động chưa được cấu hình xử lý.",
            error="UNIMPLEMENTED",
        )

    def _build_mock_success(
        self, action_name: str, params: dict[str, Any]
    ) -> ActionExecutionResponse:
        messages = {
            "mark_all_notifications_read": "Đã đánh dấu đã đọc tất cả thông báo (Chế độ mô phỏng).",
        }
        return ActionExecutionResponse(
            success=True,
            actionName=action_name,
            message=messages.get(action_name, "Thao tác thành công."),
            data={"mock": True, "params": params},
        )

    async def _store_terminal_result(
        self, redis: Any, idem_key: str, result: ActionExecutionResponse
    ) -> None:
        try:
            await redis.set(
                idem_key,
                result.model_dump_json(),
                ex=IDEMPOTENCY_TTL_SECONDS,
            )
        except Exception as exc:
            self._disable_redis(exc)

    async def _release_inflight_lease(
        self, redis: Any, idem_key: str, inflight_payload: str
    ) -> None:
        try:
            await redis.eval(_LUA_RELEASE_LEASE, 1, idem_key, inflight_payload)
        except Exception as exc:
            logger.warning(
                "Failed to release in-flight lease for %s: %s", idem_key, exc
            )

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
                socket_connect_timeout=settings.CHATBOT_REDIS_CONNECT_TIMEOUT_SECONDS,
                socket_timeout=settings.CHATBOT_REDIS_SOCKET_TIMEOUT_SECONDS,
            )
            await self._redis.ping()
            return self._redis
        except Exception as exc:
            self._disable_redis(exc)
            return None

    def _disable_redis(self, exc: Exception):
        self._redis = False
        self._redis_disabled_until = (
            time.time() + settings.CHATBOT_REDIS_RECONNECT_BACKOFF_SECONDS
        )
        if not self._redis_unavailable_logged:
            logger.warning(
                "[ActionExecutor] Redis unavailable for idempotency (fail-closed): %s",
                exc,
            )
            self._redis_unavailable_logged = True


action_executor_service = ActionExecutorService()
