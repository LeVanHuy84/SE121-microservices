from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import logging
from typing import Any
from uuid import uuid4

from app.core.settings import settings

logger = logging.getLogger("uvicorn.error")

_COLLECTION_NAME = "chatbot_action_audit_logs"
_AUDIT_TTL_SECONDS = 90 * 24 * 60 * 60  # 90 days
_AUDIT_WRITE_TIMEOUT_SECONDS = 1.5


class ActionAuditLogger:
    """Append-only MongoDB writer for chatbot write-action audit logs."""

    def __init__(self) -> None:
        self._indexes_ensured = False

    def _get_collection(self):
        if not settings.CHATBOT_DB_ENABLED:
            return None
        from app.modules.analysis.repositories.mongo import db

        return db[_COLLECTION_NAME]

    async def _ensure_indexes(self, collection: Any) -> None:
        if self._indexes_ensured:
            return
        await collection.create_index(
            [("userId", 1), ("createdAt", -1)],
            name="idx_audit_userId_createdAt",
        )
        await collection.create_index(
            [("createdAt", 1)],
            expireAfterSeconds=_AUDIT_TTL_SECONDS,
            name="idx_audit_ttl_90days",
        )
        self._indexes_ensured = True

    async def record(
        self,
        *,
        user_id: str,
        conversation_id: str,
        action_id: str,
        action_name: str,
        idempotency_key: str,
        params_hash: str,
        ai_policy: str,
        status: str,
        error_code: str | None = None,
        latency_ms: float = 0.0,
    ) -> None:
        now = datetime.now(timezone.utc)
        doc = {
            "auditId": str(uuid4()),
            "userId": user_id,
            "conversationId": conversation_id,
            "actionId": action_id,
            "actionName": action_name,
            "idempotencyKey": idempotency_key,
            "paramsHash": params_hash,
            "aiPolicy": ai_policy,
            "status": status,
            "errorCode": error_code,
            "latencyMs": round(float(latency_ms), 2),
            "createdAt": now,
        }

        collection = self._get_collection()
        if collection is None:
            self._log_stdout(doc)
            return

        try:
            async def _write():
                await self._ensure_indexes(collection)
                await collection.insert_one(doc)

            await asyncio.wait_for(_write(), timeout=_AUDIT_WRITE_TIMEOUT_SECONDS)
        except Exception as exc:
            logger.warning(
                "Action audit MongoDB write failed, falling back to stdout: %s", exc
            )
            self._log_stdout(doc)

    async def purge_user(self, user_id: str) -> int:
        collection = self._get_collection()
        if collection is None:
            return 0
        try:
            res = await asyncio.wait_for(
                collection.delete_many({"userId": user_id}),
                timeout=_AUDIT_WRITE_TIMEOUT_SECONDS,
            )
            return int(getattr(res, "deleted_count", 0))
        except Exception as exc:
            logger.warning("Failed to purge action audit logs for %s: %s", user_id, exc)
            return 0

    def _log_stdout(self, doc: dict[str, Any]) -> None:
        serializable = {
            **doc,
            "createdAt": doc["createdAt"].isoformat()
            if isinstance(doc.get("createdAt"), datetime)
            else str(doc.get("createdAt")),
        }
        logger.info("ACTION_AUDIT %s", json.dumps(serializable, ensure_ascii=False))


action_audit_logger = ActionAuditLogger()
