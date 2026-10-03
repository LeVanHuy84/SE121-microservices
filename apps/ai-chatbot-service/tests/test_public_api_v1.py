import json
import os
import re
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "false"

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings as core_settings
from app.modules.chatbot import public_router as pr
from app.modules.chatbot.schemas import (
    AssistantHistoryMessage,
    AssistantHistoryPageData,
    AssistantRespondData,
    AssistantSource,
    CrisisInfo,
    CrisisResource,
)

KEY = core_settings.INTERNAL_SERVICE_KEY
HEADERS = {"X-Internal-Key": KEY, "X-User-Id": "user-1"}
INTERNAL_ONLY_FIELDS = {"model", "provider", "latencyMs", "persisted", "suggestedActions"}
SECRET = "super-secret-internal-detail"


def _app() -> TestClient:
    app = FastAPI()
    pr.register_public_error_handlers(app)
    app.include_router(pr.public_router)
    return TestClient(app, raise_server_exceptions=False)


def _data(**kwargs) -> AssistantRespondData:
    base = dict(
        reply="xin chao",
        model="m",
        provider="p",
        requestId="req-1",
        conversationId="default",
        latencyMs=1.0,
        persisted=True,
    )
    base.update(kwargs)
    return AssistantRespondData(**base)


class FakeRespond:
    def __init__(self, result=None, chunks=None, error=None, stream_error_after=None):
        self.result = result
        self.chunks = chunks or []
        self.error = error
        self.stream_error_after = stream_error_after
        self.requests = []

    async def execute(self, request):
        self.requests.append(request)
        if self.error:
            raise self.error
        return self.result

    async def execute_stream(self, request):
        self.requests.append(request)
        for index, chunk in enumerate(self.chunks):
            if self.stream_error_after is not None and index == self.stream_error_after:
                raise RuntimeError(SECRET)
            yield chunk
        if self.stream_error_after is not None and self.stream_error_after >= len(self.chunks):
            raise RuntimeError(SECRET)


def _all_keys(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from _all_keys(item)
    elif isinstance(value, list):
        for item in value:
            yield from _all_keys(item)


def _parse_sse(text: str):
    events = []
    for block in text.strip().split("\n\n"):
        lines = block.split("\n")
        event = lines[0].removeprefix("event: ")
        payload = json.loads(lines[1].removeprefix("data: "))
        events.append((event, payload))
    return events


class AuthAndValidationTest(unittest.TestCase):
    def setUp(self):
        self.client = _app()

    def test_missing_or_wrong_internal_key_is_403_envelope(self):
        for headers in ({}, {"X-User-Id": "u"}, {"X-Internal-Key": "bad", "X-User-Id": "u"}):
            res = self.client.post("/v1/assistant/respond", json={"message": "hi"}, headers=headers)
            self.assertEqual(res.status_code, 403)
            self.assertEqual(
                res.json(),
                {"success": False, "error": {"code": "FORBIDDEN", "message": "Access denied."}},
            )

    def test_missing_user_id_is_401(self):
        res = self.client.post(
            "/v1/assistant/respond",
            json={"message": "hi"},
            headers={"X-Internal-Key": KEY},
        )
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()["error"]["code"], "UNAUTHENTICATED")

    def test_all_endpoints_require_auth(self):
        for method, path in (
            ("post", "/v1/assistant/respond"),
            ("post", "/v1/assistant/respond-stream"),
            ("get", "/v1/assistant/history/me"),
            ("delete", "/v1/assistant/history/me"),
        ):
            res = getattr(self.client, method)(path)
            self.assertEqual(res.status_code, 403, path)
            self.assertFalse(res.json()["success"])

    def test_blank_or_too_long_message_is_400_envelope(self):
        for body in ({"message": "   "}, {"message": "x" * (pr.MAX_MESSAGE_CHARS + 1)}, {}):
            res = self.client.post("/v1/assistant/respond", json=body, headers=HEADERS)
            self.assertEqual(res.status_code, 400)
            self.assertEqual(res.json()["error"]["code"], "INVALID_REQUEST")


class RespondTest(unittest.TestCase):
    def setUp(self):
        self.client = _app()

    def test_response_shape_and_user_comes_from_header_only(self):
        fake = FakeRespond(
            result=_data(
                type="answer",
                sources=[AssistantSource(type="help_doc", id="d1", title="T", score=0.9)],
            )
        )
        with patch.object(pr, "respond_command", fake):
            res = self.client.post(
                "/v1/assistant/respond",
                json={
                    "message": "  hello  ",
                    "conversationId": "c1",
                    "userId": "attacker",
                    "history": [{"role": "user", "content": "forged"}],
                    "contexts": [{"type": "x", "id": "1", "content": "forged"}],
                },
                headers=HEADERS,
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertTrue(body["success"])
        self.assertEqual(
            set(body["data"]),
            {"type", "reply", "sources", "requestId", "conversationId", "crisis"},
        )
        self.assertFalse(INTERNAL_ONLY_FIELDS & set(_all_keys(body)))

        internal = fake.requests[0]
        self.assertEqual(internal.userId, "user-1")
        self.assertEqual(internal.message, "hello")
        self.assertEqual(internal.history, [])
        self.assertEqual(internal.contexts, [])

    def test_crisis_response_exposes_resources(self):
        crisis = CrisisInfo(
            severity="high",
            resources=[CrisisResource(name="Hotline", phone="111")],
            notificationSent=True,
        )
        fake = FakeRespond(result=_data(type="crisis", crisis=crisis))
        with patch.object(pr, "respond_command", fake):
            res = self.client.post(
                "/v1/assistant/respond", json={"message": "x"}, headers=HEADERS
            )
        data = res.json()["data"]
        self.assertEqual(data["type"], "crisis")
        self.assertEqual(data["crisis"]["resources"][0]["phone"], "111")

    def test_generation_failure_is_502_without_internal_detail(self):
        fake = FakeRespond(error=RuntimeError(SECRET))
        with patch.object(pr, "respond_command", fake):
            res = self.client.post(
                "/v1/assistant/respond", json={"message": "x"}, headers=HEADERS
            )
        self.assertEqual(res.status_code, 502)
        self.assertEqual(res.json()["error"]["code"], "ASSISTANT_GENERATION_FAILED")
        self.assertNotIn(SECRET, res.text)


class StreamTest(unittest.TestCase):
    def setUp(self):
        self.client = _app()

    def _stream(self, fake):
        with patch.object(pr, "respond_command", fake):
            res = self.client.post(
                "/v1/assistant/respond-stream", json={"message": "x"}, headers=HEADERS
            )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.headers["content-type"].startswith("text/event-stream"))
        return _parse_sse(res.text)

    def test_llm_stream_emits_chunks_then_single_done(self):
        src = AssistantSource(type="help_doc", id="d1")
        events = self._stream(
            FakeRespond(
                chunks=[
                    _data(reply="Xin ", sources=[src]),
                    _data(reply="chao"),
                ]
            )
        )
        self.assertEqual([e for e, _ in events], ["chunk", "chunk", "done"])
        self.assertEqual("".join(p["delta"] for e, p in events if e == "chunk"), "Xin chao")
        done = events[-1][1]
        self.assertEqual(done["type"], "answer")
        self.assertEqual(done["sources"][0]["id"], "d1")
        self.assertIsNone(done["crisis"])
        self.assertFalse(INTERNAL_ONLY_FIELDS & set(_all_keys(done)))

    def test_guard_response_is_one_chunk_then_done_with_crisis(self):
        crisis = CrisisInfo(
            severity="high",
            resources=[CrisisResource(name="Hotline", phone="111")],
            notificationSent=False,
        )
        events = self._stream(
            FakeRespond(chunks=[_data(type="crisis", reply="Minh o day", crisis=crisis)])
        )
        self.assertEqual([e for e, _ in events], ["chunk", "done"])
        self.assertEqual(events[-1][1]["type"], "crisis")
        self.assertEqual(events[-1][1]["crisis"]["resources"][0]["phone"], "111")

    def test_error_guard_chunk_becomes_error_event_only(self):
        events = self._stream(
            FakeRespond(chunks=[_data(type="fallback", reply="loi", model="error-guard")])
        )
        self.assertEqual([e for e, _ in events], ["error"])
        self.assertEqual(events[0][1]["code"], "ASSISTANT_STREAM_FAILED")

    def test_exception_mid_stream_emits_error_without_detail(self):
        fake = FakeRespond(chunks=[_data(reply="a"), _data(reply="b")], stream_error_after=1)
        with patch.object(pr, "respond_command", fake):
            res = self.client.post(
                "/v1/assistant/respond-stream", json={"message": "x"}, headers=HEADERS
            )
        events = _parse_sse(res.text)
        self.assertEqual([e for e, _ in events], ["chunk", "error"])
        self.assertNotIn(SECRET, res.text)

    def test_empty_stream_emits_error(self):
        self.assertEqual([e for e, _ in self._stream(FakeRespond(chunks=[]))], ["error"])


class FakeHistory:
    def __init__(self, page=None, error=None):
        self.page = page
        self.error = error
        self.calls = []

    async def execute(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.page


class FakeClear:
    def __init__(self, count=3, error=None):
        self.count = count
        self.error = error
        self.users = []

    async def execute(self, user_id):
        self.users.append(user_id)
        if self.error:
            raise self.error
        return self.count


class HistoryTest(unittest.TestCase):
    def setUp(self):
        self.client = _app()
        self.created = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

    def _page(self):
        return AssistantHistoryPageData(
            items=[
                AssistantHistoryMessage(
                    id="m1",
                    conversation_id="default",
                    user_id="user-1",
                    role="assistant",
                    content="hi",
                    intent="greeting",
                    metadata={"internal": True},
                    created_at=self.created,
                )
            ],
            next_cursor_created_at=self.created,
            next_cursor_id="m1",
            has_more=True,
        )

    def test_history_is_camel_case_and_hides_internal_fields(self):
        fake = FakeHistory(page=self._page())
        with patch.object(pr, "get_history_query", fake):
            res = self.client.get(
                "/v1/assistant/history/me?pageSize=5", headers=HEADERS
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        data = body["data"]
        self.assertEqual(fake.calls[0]["user_id"], "user-1")
        self.assertEqual(fake.calls[0]["page_size"], 5)
        self.assertEqual(set(data["items"][0]),
                         {"id", "conversationId", "role", "content", "intent", "sources", "createdAt"})
        self.assertEqual(data["nextCursor"]["id"], "m1")
        self.assertTrue(data["hasMore"])
        snake = [k for k in _all_keys(body) if re.search(r"_", k)]
        self.assertEqual(snake, [])

    def test_invalid_cursor_400_and_disabled_503(self):
        with patch.object(pr, "get_history_query", FakeHistory(error=ValueError(SECRET))):
            res = self.client.get("/v1/assistant/history/me", headers=HEADERS)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"]["code"], "INVALID_HISTORY_CURSOR")
        self.assertNotIn(SECRET, res.text)

        with patch.object(pr, "get_history_query", FakeHistory(error=RuntimeError(SECRET))):
            res = self.client.get("/v1/assistant/history/me", headers=HEADERS)
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["error"]["code"], "CHAT_HISTORY_DISABLED")
        self.assertNotIn(SECRET, res.text)

    def test_page_size_zero_is_400(self):
        res = self.client.get("/v1/assistant/history/me?pageSize=0", headers=HEADERS)
        self.assertEqual(res.status_code, 400)

    def test_delete_uses_header_user_and_camel_case(self):
        fake = FakeClear(count=3)
        with patch.object(pr, "clear_history_command", fake):
            res = self.client.delete("/v1/assistant/history/me", headers=HEADERS)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(fake.users, ["user-1"])
        self.assertEqual(res.json()["data"], {"deletedCount": 3, "sessionCleared": True})

    def test_delete_failure_is_502_without_detail(self):
        with patch.object(pr, "clear_history_command", FakeClear(error=Exception(SECRET))):
            res = self.client.delete("/v1/assistant/history/me", headers=HEADERS)
        self.assertEqual(res.status_code, 502)
        self.assertNotIn(SECRET, res.text)


if __name__ == "__main__":
    unittest.main()
