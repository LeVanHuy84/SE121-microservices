"""Integration tests: NavResolver wired into RespondCommand (crisis precedence, short-circuit, how-to)."""
import asyncio
import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "false"

from app.modules.chatbot.repositories.chat_history import ChatHistoryRepository, HistoryStore
from app.modules.chatbot.repositories.user_memory_profile import UserMemoryProfileRepository
from app.modules.chatbot.schemas import AssistantContextItem, AssistantRespondRequest
from app.modules.chatbot.services.assistant import RespondCommand
from app.providers.base import LlmGeneration
from tests.unit.test_chat_history_actions import FakeDb

PRIVACY_CONTEXT = AssistantContextItem(
    type="help_doc",
    id="privacy-profile",
    title="Quyền riêng tư",
    content="Vào Cài đặt > Quyền riêng tư để thiết lập hồ sơ.",
    score=0.9,
    source="docs",
)


class FakeProvider:
    def __init__(self):
        self.calls = 0

    async def generate(self, prompt, request, **kwargs):
        self.calls += 1
        return LlmGeneration(content="fake reply", model="test-model", provider="fake")

    async def stream(self, prompt, request, **kwargs):
        self.calls += 1
        for part in ("Bước 1. ", "Bước 2."):
            yield LlmGeneration(content=part, model="test-model", provider="fake")


class FakeKafka:
    async def send(self, topic, message):
        return None


class FakeOutbox:
    async def save_outbox(self, data):
        return data


class FakeFactExtractor:
    def maybe_schedule_extraction(self, *args, **kwargs):
        return None


def _command(provider: FakeProvider) -> RespondCommand:
    db = FakeDb()
    profile_repo = UserMemoryProfileRepository(db=db)
    repo = ChatHistoryRepository(db=db, profile_repo=profile_repo)
    store = HistoryStore(repository=repo, profile_repo=profile_repo)
    return RespondCommand(
        provider=provider,
        kafka_producer=FakeKafka(),
        outbox_repo=FakeOutbox(),
        history_store_instance=store,
        profile_repo=profile_repo,
        fact_extractor=FakeFactExtractor(),
    )


def _request(user: str, message: str, contexts=None) -> AssistantRespondRequest:
    return AssistantRespondRequest(userId=user, message=message, contexts=contexts or [])


def _execute(cmd: RespondCommand, req: AssistantRespondRequest):
    return asyncio.run(cmd.execute(req))


def _stream(cmd: RespondCommand, req: AssistantRespondRequest):
    async def _run():
        return [chunk async for chunk in cmd.execute_stream(req)]

    return asyncio.run(_run())


class _TelemetryPatched(unittest.TestCase):
    def setUp(self):
        patcher = patch(
            "app.modules.chatbot.services.assistant.intent_telemetry.track_offer",
            new=MagicMock(),
        )
        self.telemetry = patcher.start()
        self.addCleanup(patcher.stop)


class CrisisPrecedenceTest(_TelemetryPatched):
    def test_crisis_with_navigation_keywords_has_no_actions(self):
        provider = FakeProvider()
        cmd = _command(provider)
        res = _execute(cmd, _request("nav-crisis-1", "tôi muốn chết, mở cài đặt quyền riêng tư"))

        self.assertEqual(res.type, "crisis")
        self.assertEqual(res.suggestedActions, [])
        self.assertEqual(provider.calls, 0)
        self.telemetry.assert_not_called()

    def test_crisis_stream_has_no_actions(self):
        cmd = _command(FakeProvider())
        chunks = _stream(cmd, _request("nav-crisis-2", "tôi muốn chết, mở cài đặt quyền riêng tư"))

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].type, "crisis")
        self.assertEqual(chunks[0].suggestedActions, [])


class PureNavigationTest(_TelemetryPatched):
    def test_command_short_circuits_llm(self):
        provider = FakeProvider()
        res = _execute(_command(provider), _request("nav-cmd-1", "mở cài đặt quyền riêng tư"))

        self.assertEqual(res.type, "navigation")
        self.assertEqual(provider.calls, 0)
        self.assertEqual(len(res.suggestedActions), 1)
        action = res.suggestedActions[0]
        self.assertEqual(action.type, "navigate")
        self.assertEqual(action.payload.destinationId, "settings.privacy")
        self.assertLessEqual(len(action.label), 40)
        self.telemetry.assert_called_once()

    def test_search_command_carries_query_params(self):
        provider = FakeProvider()
        res = _execute(_command(provider), _request("nav-cmd-2", "tìm kiếm nhóm yoga"))

        self.assertEqual(res.type, "navigation")
        self.assertEqual(provider.calls, 0)
        payload = res.suggestedActions[0].payload
        self.assertEqual(payload.destinationId, "search")
        self.assertEqual(payload.params.get("type"), "groups")
        self.assertIn("yoga", payload.params.get("q", ""))

    def test_feature_question_gets_no_actions(self):
        res = _execute(_command(FakeProvider()), _request("nav-cmd-3", "Chat hiện tại có chức năng video call không?"))

        self.assertEqual(res.suggestedActions, [])
        self.telemetry.assert_not_called()


class HowToNavigationTest(_TelemetryPatched):
    def test_howto_calls_llm_and_attaches_actions(self):
        provider = FakeProvider()
        res = _execute(
            _command(provider),
            _request("nav-howto-1", "Làm sao để đổi quyền riêng tư hồ sơ?", [PRIVACY_CONTEXT]),
        )

        self.assertEqual(provider.calls, 1)
        self.assertEqual(res.type, "answer")
        destinations = [a.payload.destinationId for a in res.suggestedActions]
        self.assertIn("settings.privacy", destinations)
        self.assertLessEqual(len(res.suggestedActions), 3)

    def test_howto_stream_emits_actions_on_first_chunk_only(self):
        provider = FakeProvider()
        chunks = _stream(
            _command(provider),
            _request("nav-howto-2", "Làm sao để đổi quyền riêng tư hồ sơ?", [PRIVACY_CONTEXT]),
        )

        self.assertEqual(provider.calls, 1)
        self.assertGreaterEqual(len(chunks), 2)
        self.assertTrue(chunks[0].suggestedActions)
        for chunk in chunks[1:]:
            self.assertEqual(chunk.suggestedActions, [])


if __name__ == "__main__":
    unittest.main()
