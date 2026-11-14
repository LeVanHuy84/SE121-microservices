from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.database import get_database
from app.core.settings import settings

logger = logging.getLogger("uvicorn.error")

CANONICAL_FACT_KEYS: frozenset[str] = frozenset({
    "name",
    "occupation",
    "work_mode",
    "sleep_health",
    "diet_exercise",
    "interests",
    "current_goal",
    "tone_preference",
})

MAX_FACT_VALUE_CHARS: int = 100


class UserMemoryProfileRepository:
    def __init__(self, db: AsyncIOMotorDatabase | None = None):
        self._db = db
        self._in_memory_profiles: dict[str, dict[str, Any]] = {}

    @property
    def db(self) -> AsyncIOMotorDatabase | None:
        if self._db is None and settings.CHATBOT_DB_ENABLED:
            try:
                self._db = get_database()
            except Exception as exc:
                logger.warning("Failed to obtain MongoDB instance for UserMemoryProfileRepository: %s", exc)
                self._db = None
        return self._db

    async def get_facts_by_user(self, user_id: str) -> dict[str, str]:
        if not user_id:
            return {}

        if self.db is None:
            profile = self._in_memory_profiles.get(user_id)
            if not profile:
                return {}
            facts = profile.get("facts", {})
            return {
                k: v
                for k, v in facts.items()
                if k in CANONICAL_FACT_KEYS and isinstance(v, str) and v.strip()
            }

        try:
            col = self.db["user_memory_profiles"]
            doc = await col.find_one({"_id": user_id})
            if not doc:
                return {}
            facts = doc.get("facts", {})
            if not isinstance(facts, dict):
                return {}
            return {
                k: v
                for k, v in facts.items()
                if k in CANONICAL_FACT_KEYS and isinstance(v, str) and v.strip()
            }
        except Exception as exc:
            logger.warning("Error fetching memory facts for userId=%s: %s", user_id, exc)
            profile = self._in_memory_profiles.get(user_id)
            if profile:
                facts = profile.get("facts", {})
                return {
                    k: v
                    for k, v in facts.items()
                    if k in CANONICAL_FACT_KEYS and isinstance(v, str) and v.strip()
                }
            return {}

    async def apply_fact_diff(
        self,
        user_id: str,
        to_set: dict[str, str],
        to_unset: list[str] | set[str],
    ) -> dict[str, str]:
        if not user_id:
            return {}

        clean_set: dict[str, str] = {}
        for k, v in (to_set or {}).items():
            if k in CANONICAL_FACT_KEYS and isinstance(v, str):
                normalized = " ".join(v.split())[:MAX_FACT_VALUE_CHARS]
                if normalized:
                    clean_set[k] = normalized

        clean_unset: set[str] = set()
        for k in (to_unset or []):
            if k in CANONICAL_FACT_KEYS and k not in clean_set:
                clean_unset.add(k)

        if not clean_set and not clean_unset:
            return await self.get_facts_by_user(user_id)

        now = datetime.now(timezone.utc)

        if self.db is None:
            profile = self._in_memory_profiles.setdefault(
                user_id,
                {"_id": user_id, "facts": {}, "updated_at": now},
            )
            facts = profile.setdefault("facts", {})
            for k, v in clean_set.items():
                facts[k] = v
            for k in clean_unset:
                facts.pop(k, None)
            profile["updated_at"] = now
            return {
                k: v
                for k, v in facts.items()
                if k in CANONICAL_FACT_KEYS and isinstance(v, str) and v.strip()
            }

        update_doc: dict[str, Any] = {}
        set_fields: dict[str, Any] = {"updated_at": now}
        for k, v in clean_set.items():
            set_fields[f"facts.{k}"] = v
        update_doc["$set"] = set_fields

        if clean_unset:
            update_doc["$unset"] = {f"facts.{k}": "" for k in clean_unset}

        try:
            col = self.db["user_memory_profiles"]
            await col.update_one({"_id": user_id}, update_doc, upsert=True)
        except Exception as exc:
            logger.warning("Failed to apply fact diff for userId=%s: %s", user_id, exc)
            profile = self._in_memory_profiles.setdefault(
                user_id,
                {"_id": user_id, "facts": {}, "updated_at": now},
            )
            facts = profile.setdefault("facts", {})
            for k, v in clean_set.items():
                facts[k] = v
            for k in clean_unset:
                facts.pop(k, None)
            profile["updated_at"] = now

        return await self.get_facts_by_user(user_id)

    async def delete_by_user(self, user_id: str) -> bool:
        if not user_id:
            return False

        if self.db is None:
            existed = user_id in self._in_memory_profiles
            self._in_memory_profiles.pop(user_id, None)
            return existed

        try:
            col = self.db["user_memory_profiles"]
            res = await col.delete_one({"_id": user_id})
            self._in_memory_profiles.pop(user_id, None)
            return bool(res.deleted_count > 0)
        except Exception as exc:
            logger.warning("Failed to delete memory profile for userId=%s: %s", user_id, exc)
            existed = user_id in self._in_memory_profiles
            self._in_memory_profiles.pop(user_id, None)
            return existed


user_memory_profile_repo = UserMemoryProfileRepository()
