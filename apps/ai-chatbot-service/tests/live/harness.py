from __future__ import annotations

import json
import os
import re
import signal
import socket
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional, TypeVar
from urllib.parse import urlparse

import httpx
import psycopg
import pymongo
import redis
from dotenv import load_dotenv

T = TypeVar("T")

REPO_ROOT = Path(__file__).resolve().parents[4]
AI_SERVICE_ROOT = Path(__file__).resolve().parents[2]
API_GATEWAY_ROOT = REPO_ROOT / "apps" / "api-gateway"

load_dotenv(AI_SERVICE_ROOT / ".env", override=False)
load_dotenv(REPO_ROOT / "apps" / "user-social-service" / ".env", override=False)

DEFAULT_GATEWAY_URL = os.getenv("API_GATEWAY_URL", "http://localhost:4000").rstrip("/")
DEFAULT_AI_URL = os.getenv("AI_CHATBOT_URL", "http://localhost:4006").rstrip("/")
DEFAULT_REDIS_URL = os.getenv("CHATBOT_REDIS_URL", "redis://localhost:6379/0")
DEFAULT_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
DEFAULT_MONGO_DB = os.getenv("MONGO_DB", "ai_chatbot_service")
DEFAULT_EMOTION_MONGO_DB = os.getenv("EMOTION_MONGO_DB", "emotion-intelligence-service")
DEFAULT_DATABASE_URL = os.getenv("DATABASE_URL", "")
DEFAULT_ES_NODE = os.getenv("ES_NODE", "http://localhost:9200").rstrip("/")
DEFAULT_KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")


def generate_run_id() -> str:
    return uuid.uuid4().hex[:8]


def make_test_user_id(run_id: str, case: str) -> str:
    return f"mock_user_e2e_{run_id}_{case}"


def run_prefix(run_id: str) -> str:
    return f"mock_user_e2e_{run_id}_"


def check_tcp_port(host: str, port: int, timeout: float = 1.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def wait_for_http_ready(
    url: str,
    timeout: float = 30.0,
    interval: float = 0.25,
    expected_statuses: tuple[int, ...] = (200,),
) -> None:
    deadline = time.monotonic() + timeout
    last_err: str = "no response"
    while time.monotonic() < deadline:
        try:
            resp = httpx.get(url, timeout=2.0)
            if resp.status_code in expected_statuses:
                return
            last_err = f"HTTP {resp.status_code}"
        except Exception as exc:
            last_err = str(exc)
        time.sleep(interval)
    raise RuntimeError(
        f"Service at {url} did not become ready within {timeout}s ({last_err})"
    )


def ensure_slice_ready(slice_name: str) -> None:
    ai_port = urlparse(DEFAULT_AI_URL).port or 4006
    gw_port = urlparse(DEFAULT_GATEWAY_URL).port or 4000
    required_ports: dict[str, list[tuple[str, int, str]]] = {
        "1A": [
            ("localhost", gw_port, "api-gateway"),
            ("localhost", 4001, "user-social-service"),
            ("localhost", ai_port, "ai-chatbot-service"),
            ("localhost", 6379, "redis"),
        ],
        "1B": [
            ("localhost", gw_port, "api-gateway"),
            ("localhost", 4001, "user-social-service"),
            ("localhost", 4002, "content-feed-service"),
            ("localhost", 4003, "search-recommendation-service"),
            ("localhost", 4005, "emotion-intelligence-service"),
            ("localhost", ai_port, "ai-chatbot-service"),
            ("localhost", 6379, "redis"),
        ],
        "1C": [
            ("localhost", 4005, "emotion-intelligence-service"),
            ("localhost", ai_port, "ai-chatbot-service"),
            ("localhost", 9092, "kafka"),
            ("localhost", 6379, "redis"),
        ],
    }

    checks = required_ports.get(slice_name)
    if not checks:
        raise ValueError(f"Unknown slice: {slice_name}")

    missing = [
        f"{label} ({host}:{port})"
        for host, port, label in checks
        if not check_tcp_port(host, port)
    ]
    if missing:
        raise RuntimeError(
            f"Slice {slice_name} prerequisites are not reachable: {', '.join(missing)}"
        )

    if slice_name in ("1A", "1B", "1C"):
        wait_for_http_ready(f"{DEFAULT_AI_URL}/ready", timeout=5.0)


def poll_until(
    predicate: Callable[[], Optional[T]],
    timeout_seconds: float = 10.0,
    interval_seconds: float = 0.25,
    description: str = "condition",
) -> T:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(interval_seconds)
    raise AssertionError(
        f"Timed out after {timeout_seconds}s waiting for {description}"
    )


def get_redis_client() -> redis.Redis:
    return redis.Redis.from_url(DEFAULT_REDIS_URL, decode_responses=True)


def get_mongo_client() -> pymongo.MongoClient:
    return pymongo.MongoClient(DEFAULT_MONGO_URL, serverSelectionTimeoutMS=5000)


def get_pg_connection() -> psycopg.Connection:
    if not DEFAULT_DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL must be set to seed/clean PostgreSQL test users"
        )
    return psycopg.connect(DEFAULT_DATABASE_URL)


def seed_pg_user(
    user_id: str,
    ai_policy: str = "FULL",
    email: Optional[str] = None,
    first_name: str = "E2E",
    last_name: str = "User",
) -> None:
    resolved_email = email or f"{user_id}@e2e.local"
    privacy_settings = json.dumps(
        {
            "profileVisibility": "PUBLIC",
            "messagePrivacy": "EVERYONE",
            "friendListVisibility": "PUBLIC",
            "allowProactiveIntervention": True,
            "aiPolicy": ai_policy,
        }
    )
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (id, email, is_active, user_status)
                VALUES (%s, %s, TRUE, 'ACTIVE')
                ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, is_active = TRUE
                """,
                (user_id, resolved_email),
            )
            cur.execute("DELETE FROM profiles WHERE user_id = %s", (user_id,))
            cur.execute(
                """
                INSERT INTO profiles (user_id, first_name, last_name, privacy_settings)
                VALUES (%s, %s, %s, %s::jsonb)
                """,
                (user_id, first_name, last_name, privacy_settings),
            )
        conn.commit()


def delete_pg_users_by_prefix(prefix: str) -> int:
    if not DEFAULT_DATABASE_URL:
        return 0
    with get_pg_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM users WHERE id LIKE %s", (f"{prefix}%",))
            deleted = cur.rowcount or 0
        conn.commit()
    return deleted


def clear_user_policy_cache(user_id: str) -> None:
    client = get_redis_client()
    try:
        client.delete(f"user:ai_policy:{user_id}")
    finally:
        client.close()


def delete_redis_keys_by_prefix(prefix: str) -> int:
    client = get_redis_client()
    deleted = 0
    try:
        pattern = f"*{prefix}*"
        batch: list[str] = []
        for key in client.scan_iter(match=pattern, count=200):
            batch.append(key)
            if len(batch) >= 200:
                deleted += client.delete(*batch)
                batch.clear()
        if batch:
            deleted += client.delete(*batch)
    finally:
        client.close()
    return deleted


def cleanup_mongo_by_prefix(prefix: str) -> dict[str, int]:
    regex = f"^{re.escape(prefix)}"
    counts: dict[str, int] = {}
    client = get_mongo_client()
    try:
        ai_db = client[DEFAULT_MONGO_DB]
        ai_queries: dict[str, dict[str, Any]] = {
            "chat_conversations": {"user_id": {"$regex": regex}},
            "chat_messages": {"user_id": {"$regex": regex}},
            "user_memory_profiles": {"_id": {"$regex": regex}},
            "chatbot_action_audit_logs": {"userId": {"$regex": regex}},
            "assistant_intent_events": {
                "$or": [
                    {"userId": {"$regex": regex}},
                    {"user_id": {"$regex": regex}},
                ]
            },
            "emotion_aggregates": {
                "$or": [
                    {"userId": {"$regex": regex}},
                    {"user_id": {"$regex": regex}},
                ]
            },
            "processed_events": {
                "$or": [
                    {"userId": {"$regex": regex}},
                    {"eventId": {"$regex": regex}},
                    {"targetId": {"$regex": regex}},
                ]
            },
            "outbox_events": {
                "$or": [
                    {"userId": {"$regex": regex}},
                    {"payload.userId": {"$regex": regex}},
                ]
            },
        }
        for col_name, query in ai_queries.items():
            res = ai_db[col_name].delete_many(query)
            counts[f"{DEFAULT_MONGO_DB}.{col_name}"] = res.deleted_count

        emotion_db = client[DEFAULT_EMOTION_MONGO_DB]
        emotion_queries: dict[str, dict[str, Any]] = {
            "user_risk_states": {"userId": {"$regex": regex}},
            "intervention_logs": {"userId": {"$regex": regex}},
            "user_emotion_snapshots": {"userId": {"$regex": regex}},
        }
        for col_name, query in emotion_queries.items():
            res = emotion_db[col_name].delete_many(query)
            counts[f"{DEFAULT_EMOTION_MONGO_DB}.{col_name}"] = res.deleted_count
    finally:
        client.close()
    return counts


def cleanup_es_by_prefix(prefix: str) -> None:
    for index_name in ("posts", "users", "groups"):
        try:
            httpx.post(
                f"{DEFAULT_ES_NODE}/{index_name}/_delete_by_query",
                json={
                    "query": {
                        "bool": {
                            "should": [
                                {"prefix": {"userId.keyword": prefix}},
                                {"prefix": {"authorId.keyword": prefix}},
                                {"prefix": {"id.keyword": prefix}},
                            ],
                            "minimum_should_match": 1,
                        }
                    }
                },
                timeout=3.0,
            )
        except Exception:
            pass


def cleanup_run_namespace(prefix: str) -> None:
    delete_redis_keys_by_prefix(prefix)
    cleanup_mongo_by_prefix(prefix)
    cleanup_es_by_prefix(prefix)
    delete_pg_users_by_prefix(prefix)


def start_isolated_gateway(
    port: int,
    metrics_port: int,
    extra_env: Optional[dict[str, str]] = None,
    timeout: float = 30.0,
) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["GATEWAY_PORT"] = str(port)
    env["METRICS_PORT"] = str(metrics_port)
    if extra_env:
        env.update(extra_env)

    dist_main = API_GATEWAY_ROOT / "dist" / "main.js"
    if dist_main.exists():
        cmd = ["node", str(dist_main)]
    else:
        cmd = ["npm", "run", "start:dev"]

    proc = subprocess.Popen(
        cmd,
        cwd=str(API_GATEWAY_ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    try:
        wait_for_http_ready(
            f"http://localhost:{port}/api/v1/health",
            timeout=timeout,
            expected_statuses=(200, 401, 403, 404),
        )
    except Exception:
        stop_process(proc)
        raise
    return proc


def stop_process(proc: Optional[subprocess.Popen[str]]) -> None:
    if proc is None:
        return
    try:
        if proc.poll() is None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                proc.wait(timeout=5)
            except Exception:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except Exception:
                    proc.kill()
    finally:
        if proc.stdout is not None:
            proc.stdout.close()
        if proc.stderr is not None:
            proc.stderr.close()
