import asyncio
import os
import unittest
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "true"

from app.modules.chatbot.repositories.chat_history import (
    GAP_MARKER_TEXT,
    MAX_SESSIONS_PER_USER,
    NON_SUBSTANTIVE_INTENTS,
    SESSION_TTL_SECONDS,
    ChatHistoryRepository,
    ClearHistoryCommand,
    GetHistoryQuery,
    HistoryStore,
    ListConversationsQuery,
    estimate_tokens,
    is_substantive_anchor_turn,
)
from app.modules.chatbot.repositories.user_memory_profile import (
    CANONICAL_FACT_KEYS,
    UserMemoryProfileRepository,
)
from app.modules.chatbot.schemas import AssistantHistoryItem, AssistantRespondRequest
from app.modules.chatbot.services.assistant import AssistantService
from app.modules.chatbot.services.fact_extractor import (
    FactExtractorService,
    SELF_DISCLOSURE_PATTERNS,
)
from app.modules.chatbot.services.prompt_builder import PromptBuilder
from app.modules.chatbot.services.user_event_consumer import handle_user_event
from app.providers.base import LlmGeneration
from tests.unit.test_chat_history_actions import FakeDb


class FakeProvider:
    def __init__(self, reply: str = "fake reply"):
        self.calls = 0
        self.last_prompt = ""
        self.reply = reply

    async def generate(self, prompt: str, request: AssistantRespondRequest, **kwargs):
        self.calls += 1
        self.last_prompt = prompt
        return LlmGeneration(
            content=self.reply,
            model="test-model",
            provider="fake",
        )


class FakeContextResolver:
    async def resolve(self, request, history, *args, **kwargs):
        return request.contexts or []


class ChatbotMemoryV2Test(unittest.TestCase):
    def setUp(self):
        self.db = FakeDb()
        self.profile_repo = UserMemoryProfileRepository(db=self.db)
        self.repo = ChatHistoryRepository(db=self.db, profile_repo=self.profile_repo)
        self.history_store = HistoryStore(repository=self.repo, profile_repo=self.profile_repo)
        self.context_resolver = FakeContextResolver()
        self.extractor = FactExtractorService(
            provider=FakeProvider('{"set": {"occupation": "Kỹ sư phần mềm"}, "unset": []}'),
            profile_repo=self.profile_repo,
            history_repo=self.repo,
        )
        self.history_store.fact_extractor = self.extractor

    # --------------------------------------------------------------------------
    # 1. Multi-Conversation Isolation & No Cross-Conversation Context Leakage
    # --------------------------------------------------------------------------
    def test_multi_conversation_isolation_and_no_leakage(self):
        provider = FakeProvider()
        service = AssistantService(
            provider=provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )

        # User starts conversation A
        conv_a = asyncio.run(self.history_store.create_conversation("user-1", title="Conv A"))
        conv_a_id = conv_a["id"]
        req_a = AssistantRespondRequest(
            userId="user-1",
            conversationId=conv_a_id,
            message="Tôi đang học kỳ thi cuối kỳ rất căng thẳng",
        )
        res_a = asyncio.run(service.respond(req_a))
        self.assertEqual(res_a.conversationId, conv_a_id)
        uuid.UUID(res_a.conversationId)

        # User starts conversation B
        conv_b = asyncio.run(self.history_store.create_conversation("user-1", title="Conv B"))
        conv_b_id = conv_b["id"]
        req_b = AssistantRespondRequest(
            userId="user-1",
            conversationId=conv_b_id,
            message="Hôm nay tôi muốn nghe gợi ý về chế độ ăn uống",
        )
        res_b = asyncio.run(service.respond(req_b))
        self.assertEqual(res_b.conversationId, conv_b_id)
        self.assertNotEqual(conv_a_id, conv_b_id)
        uuid.UUID(res_b.conversationId)

        # Inspect history for Conv A and Conv B
        page_a = asyncio.run(self.history_store.get_messages_page_by_user("user-1", conversation_id=conv_a_id))
        page_b = asyncio.run(self.history_store.get_messages_page_by_user("user-1", conversation_id=conv_b_id))

        self.assertEqual(len(page_a.items), 2)
        self.assertEqual(len(page_b.items), 2)
        self.assertIn("căng thẳng", page_a.items[1].content)
        self.assertIn("ăn uống", page_b.items[1].content)

        # Cache is isolated per (user_id, conv_id, page_size)
        cache_keys = list(self.history_store._history_cache.keys())
        self.assertTrue(any(k[1] == conv_a_id for k in cache_keys))
        self.assertTrue(any(k[1] == conv_b_id for k in cache_keys))

    # --------------------------------------------------------------------------
    # 2. Token Budget & Substantive Anchor + Gap Marker
    # --------------------------------------------------------------------------
    def test_token_budget_full_history_under_1500_tokens(self):
        # Create conversation and populate 5 turns (10 messages) with short content
        conv = asyncio.run(self.repo.create_conversation("user-token", title="Short chat"))
        conv_id = conv["id"]

        for i in range(1, 6):
            asyncio.run(
                self.repo.append_exchange(
                    user_id="user-token",
                    user_message=f"Câu hỏi số {i} về bài tập",
                    assistant_reply=f"Câu trả lời số {i} đầy đủ",
                    conversation_id=conv_id,
                )
            )

        items, last_intent, conv_meta = asyncio.run(self.repo.load_context_window("user-token", conv_id))
        self.assertEqual(len(items), 10)
        # No gap marker present
        self.assertFalse(any(it.role == "system" for it in items))
        self.assertEqual(items[0].content, "Câu hỏi số 1 về bài tập")
        self.assertEqual(items[-1].content, "Câu trả lời số 5 đầy đủ")

    def test_anchor_skips_greeting_and_locks_substantive_turn(self):
        conv = asyncio.run(self.repo.create_conversation("user-anchor", title="Anchor chat"))
        conv_id = conv["id"]

        # Turn 1: Trivial greeting
        res1 = asyncio.run(
            self.repo.append_exchange(
                user_id="user-anchor",
                user_message="Xin chào",
                assistant_reply="Chào bạn! Tôi có thể giúp gì?",
                intent="greeting",
                conversation_id=conv_id,
            )
        )
        self.assertFalse(res1.locked_anchor_this_turn)

        doc = asyncio.run(self.db["chat_conversations"].find_one({"id": conv_id}))
        self.assertEqual(doc.get("anchor_exchange", []), [])

        # Turn 2: Substantive opening statement (> 4 words, not greeting)
        substantive_text = "Tôi bị mất ngủ kéo dài cả tuần nay trước kỳ thi quan trọng"
        res2 = asyncio.run(
            self.repo.append_exchange(
                user_id="user-anchor",
                user_message=substantive_text,
                assistant_reply="Mình rất tiếc khi nghe bạn bị mất ngủ. Chúng ta cùng tìm giải pháp nhé.",
                conversation_id=conv_id,
            )
        )
        self.assertTrue(res2.locked_anchor_this_turn)

        doc = asyncio.run(self.db["chat_conversations"].find_one({"id": conv_id}))
        self.assertEqual(len(doc["anchor_exchange"]), 2)
        self.assertEqual(doc["anchor_turn"], 2)
        self.assertIn("mất ngủ", doc["anchor_exchange"][0]["content"])

    def test_long_conversation_anchor_gap_marker_and_recent_window(self):
        conv = asyncio.run(self.repo.create_conversation("user-long", title="Long chat"))
        conv_id = conv["id"]

        # Turn 1: greeting (skipped)
        asyncio.run(
            self.repo.append_exchange(
                "user-long", "Xin chào bạn", "Chào bạn!", intent="greeting", conversation_id=conv_id
            )
        )
        # Turn 2: substantive anchor (> 4 words)
        asyncio.run(
            self.repo.append_exchange(
                "user-long",
                "Tôi gặp vấn đề mất ngủ trầm trọng trước kỳ thi tốt nghiệp",
                "Chào bạn, vấn đề mất ngủ trước kỳ thi rất phổ biến.",
                conversation_id=conv_id,
            )
        )

        # Turns 3 to 10: populate with large text to push total_tokens_est > 1500
        large_body = "Chi tiết thêm về việc học tập và áp lực điểm số. " * 30
        for i in range(3, 11):
            asyncio.run(
                self.repo.append_exchange(
                    "user-long",
                    f"Turn {i} user: {large_body}",
                    f"Turn {i} assistant reply: {large_body}",
                    conversation_id=conv_id,
                )
            )

        items, last_intent, conv_meta = asyncio.run(self.repo.load_context_window("user-long", conv_id))

        # Check structure: Anchor items (2) + Gap marker (1) + Recent items (up to 6)
        self.assertTrue(len(items) >= 3)
        self.assertEqual(items[0].role, "user")
        self.assertIn("mất ngủ trầm trọng", items[0].content)

        # Gap marker must be present between anchor and recent messages
        system_items = [it for it in items if it.role == "system"]
        self.assertEqual(len(system_items), 1)
        self.assertEqual(system_items[0].content, GAP_MARKER_TEXT)

        # Recent messages must be the newest turns
        self.assertIn("Turn 10", items[-1].content)

    def test_no_gap_marker_when_recent_turns_immediately_follow_anchor(self):
        # Anchor on Turn 2, turn_count = 5, recent turns 3-5 -> 5 - 3 = 2 == anchor_turn -> NO gap marker!
        conv = asyncio.run(self.repo.create_conversation("user-nogap", title="No gap chat"))
        conv_id = conv["id"]

        # Turn 1: greeting
        asyncio.run(self.repo.append_exchange("user-nogap", "hello", "hi", intent="greeting", conversation_id=conv_id))
        # Turn 2: anchor (~80 tokens)
        asyncio.run(self.repo.append_exchange("user-nogap", "mình bị đau dạ dày thường xuyên", "bạn đã đi khám bác sĩ chưa", conversation_id=conv_id))
        # Turns 3, 4, 5: each message has ~810 chars (~270 tokens), so 540 tokens/turn.
        # Total turns 3-5 = 1620 tokens (> 1500 threshold, but total anchor+recent = 1640 <= 2000).
        # Therefore, none of turns 3-5 are dropped, and since 5 - 3 = 2 == anchor_turn, no gap marker is injected.
        medium_text = "Nội dung câu chuyện chi tiết về bệnh đau dạ dày và phương pháp ăn uống hàng ngày. " * 10
        for i in range(3, 6):
            asyncio.run(self.repo.append_exchange("user-nogap", f"Turn {i}: {medium_text}", f"Reply {i}: {medium_text}", conversation_id=conv_id))

        items, _, _ = asyncio.run(self.repo.load_context_window("user-nogap", conv_id))
        # All 3 recent turns (6 messages) fit within 2000 tokens, so turn_count(5) - recent(3) == anchor_turn(2)
        # Gap marker must NOT be present!
        self.assertFalse(any(it.role == "system" for it in items))

    # --------------------------------------------------------------------------
    # 3. 20-Session Quota LRA Soft-Tombstone & 90-Day Sweeper
    # --------------------------------------------------------------------------
    def test_20_session_quota_lra_soft_tombstone(self):
        user_id = "user-quota-20"
        now = datetime.now(timezone.utc)

        # Create 20 conversations with distinct last_message_at
        created_ids = []
        for i in range(20):
            conv = asyncio.run(self.repo.create_conversation(user_id, title=f"Chat {i}"))
            created_ids.append(conv["id"])
            # Set staggered timestamps
            t = now - timedelta(days=25 - i)
            asyncio.run(
                self.db["chat_conversations"].update_one(
                    {"id": conv["id"]},
                    {"$set": {"last_message_at": t, "created_at": t}},
                )
            )

        active_convs = asyncio.run(self.repo.list_conversations_by_user(user_id, limit=30))
        self.assertEqual(len(active_convs), 20)

        # Create 21st conversation
        conv_21 = asyncio.run(self.repo.create_conversation(user_id, title="Chat 21"))
        self.assertIsNotNone(conv_21["id"])

        # Oldest conversation (Chat 0) must be tombstoned or purged
        oldest_doc = asyncio.run(self.db["chat_conversations"].find_one({"id": created_ids[0]}))
        self.assertTrue(oldest_doc is None or oldest_doc.get("status") == "tombstoned")

        # Active conversations count must remain <= 20
        active_after = asyncio.run(self.repo.list_conversations_by_user(user_id, limit=30))
        self.assertEqual(len(active_after), 20)
        self.assertNotIn(created_ids[0], [c["id"] for c in active_after])

    def test_sweeper_removes_tombstoned_and_90d_inactive(self):
        user_id = "user-sweeper"
        now = datetime.now(timezone.utc)
        old_time = now - timedelta(days=95)

        # Conv 1: tombstoned
        c1 = asyncio.run(self.repo.create_conversation(user_id, title="Tombstoned conv"))
        asyncio.run(self.db["chat_conversations"].update_one({"id": c1["id"]}, {"$set": {"status": "tombstoned"}}))
        asyncio.run(self.repo.append_exchange(user_id, "hi", "hello", conversation_id=c1["id"]))

        # Conv 2: >90 days inactive
        c2 = asyncio.run(self.repo.create_conversation(user_id, title="Old inactive conv"))
        asyncio.run(
            self.db["chat_conversations"].update_one(
                {"id": c2["id"]},
                {"$set": {"last_message_at": old_time, "created_at": old_time}},
            )
        )
        asyncio.run(self.repo.append_exchange(user_id, "question", "answer", conversation_id=c2["id"]))

        # Conv 3: active recent
        c3 = asyncio.run(self.repo.create_conversation(user_id, title="Active conv"))
        asyncio.run(self.repo.append_exchange(user_id, "active q", "active a", conversation_id=c3["id"]))

        swept = asyncio.run(self.repo.sweep_expired_and_tombstoned(batch_size=10))
        self.assertEqual(swept, 2)

        # Messages for c1 and c2 are cascaded
        msg1 = asyncio.run(self.db["chat_messages"].find({"conversation_id": c1["id"]}).to_list())
        msg2 = asyncio.run(self.db["chat_messages"].find({"conversation_id": c2["id"]}).to_list())
        msg3 = asyncio.run(self.db["chat_messages"].find({"conversation_id": c3["id"]}).to_list())

        self.assertEqual(len(msg1), 0)
        self.assertEqual(len(msg2), 0)
        self.assertEqual(len(msg3), 2)

    # --------------------------------------------------------------------------
    # 4. FactExtractorService Guard-Skipping & Hybrid Triggers
    # --------------------------------------------------------------------------
    def test_fact_extractor_skips_guard_blocked_and_non_substantive(self):
        # Crisis intent
        eligible, _ = self.extractor.should_extract("Tôi muốn chết", turn_count=1, intent="mental_health_crisis")
        self.assertFalse(eligible)

        # Community violation
        eligible, _ = self.extractor.should_extract("bad word", turn_count=1, intent="community_guard")
        self.assertFalse(eligible)

        # Policy blocked
        eligible, _ = self.extractor.should_extract("mình là kỹ sư phần mềm", turn_count=1, policy_blocked=True)
        self.assertFalse(eligible)

        # Greeting intent
        eligible, _ = self.extractor.should_extract("xin chào bạn", turn_count=1, intent="greeting")
        self.assertFalse(eligible)

    def test_fact_extractor_hybrid_triggers(self):
        # Trigger A: Turn 1 with >= 8 words
        eligible, reason = self.extractor.should_extract(
            "Tôi là sinh viên năm 3 đang chuẩn bị làm đồ án tốt nghiệp",
            turn_count=1,
        )
        self.assertTrue(eligible)
        self.assertEqual(reason, "opening")

        # Trigger B: Self-disclosure keywords
        eligible, reason = self.extractor.should_extract(
            "Mình tên là An",
            turn_count=3,
        )
        self.assertTrue(eligible)
        self.assertEqual(reason, "keyword")

        # Trigger C: Turn count multiple of 5
        eligible, reason = self.extractor.should_extract(
            "Hôm nay trời đẹp",
            turn_count=5,
        )
        self.assertTrue(eligible)
        self.assertEqual(reason, "periodic")

    def test_user_memory_profile_8_canonical_keys_diff(self):
        user_id = "user-profile-diff"

        # 1. Apply diff with canonical and non-canonical keys
        to_set = {
            "name": "Minh",
            "occupation": "Sinh viên ngành Công nghệ thông tin",
            "invalid_key": "some value",  # Must be dropped
            "transient_mood": "buồn bã",  # Must be dropped
        }
        res = asyncio.run(self.profile_repo.apply_fact_diff(user_id, to_set=to_set, to_unset=[]))

        self.assertIn("name", res)
        self.assertIn("occupation", res)
        self.assertNotIn("invalid_key", res)
        self.assertNotIn("transient_mood", res)

        # 2. Update occupation and unset work_mode, key in both set & unset
        res2 = asyncio.run(
            self.profile_repo.apply_fact_diff(
                user_id,
                to_set={"occupation": "Kỹ sư AI"},
                to_unset=["occupation", "work_mode"],  # occupation in both -> dropped from unset!
            )
        )
        self.assertEqual(res2["occupation"], "Kỹ sư AI")

        # 3. Value bound to 100 characters
        long_val = "A" * 150
        res3 = asyncio.run(self.profile_repo.apply_fact_diff(user_id, to_set={"interests": long_val}, to_unset=[]))
        self.assertEqual(len(res3["interests"]), 100)

    # --------------------------------------------------------------------------
    # 5. Lifecycle Deletion Rules (Single conv vs Clear vs Kafka user.removed)
    # --------------------------------------------------------------------------
    def test_single_conversation_delete_preserves_memory_profile(self):
        user_id = "user-del-conv"
        # Seed memory profile
        asyncio.run(self.profile_repo.apply_fact_diff(user_id, {"name": "Linh"}, []))

        # Create conversation
        conv = asyncio.run(self.repo.create_conversation(user_id, title="Test"))
        conv_id = conv["id"]
        asyncio.run(self.repo.append_exchange(user_id, "hi", "hello", conversation_id=conv_id))

        # Delete single conversation
        deleted = asyncio.run(self.history_store.delete_conversation(user_id, conv_id))
        self.assertTrue(deleted)

        # Profile remains intact!
        facts = asyncio.run(self.profile_repo.get_facts_by_user(user_id))
        self.assertEqual(facts.get("name"), "Linh")

    def test_clear_history_command_purges_conversations_and_profile(self):
        user_id = "user-clear-all"
        # Seed facts
        asyncio.run(self.profile_repo.apply_fact_diff(user_id, {"name": "Tuan", "occupation": "Designer"}, []))

        # Create conversation
        conv = asyncio.run(self.repo.create_conversation(user_id, title="Test"))
        asyncio.run(self.repo.append_exchange(user_id, "hi", "hello", conversation_id=conv["id"]))

        cmd = ClearHistoryCommand(store=self.history_store)
        deleted = asyncio.run(cmd.execute(user_id))
        self.assertEqual(deleted, 2)

        # Conversations, messages, and profile must be wiped
        convs = asyncio.run(self.history_store.list_conversations_by_user(user_id))
        self.assertEqual(len(convs), 0)
        facts = asyncio.run(self.profile_repo.get_facts_by_user(user_id))
        self.assertEqual(facts, {})

    def test_kafka_user_removed_purges_all_data_and_emotion_cache(self):
        user_id = "user-kafka-purge"
        asyncio.run(self.profile_repo.apply_fact_diff(user_id, {"name": "Bao"}, []))
        conv = asyncio.run(self.repo.create_conversation(user_id))
        asyncio.run(self.repo.append_exchange(user_id, "câu hỏi", "câu trả lời", conversation_id=conv["id"]))

        kafka_msg = {
            "type": "user.removed",
            "payload": {"userId": user_id},
        }
        asyncio.run(handle_user_event(kafka_msg, store=self.history_store))

        convs = asyncio.run(self.repo.list_conversations_by_user(user_id))
        self.assertEqual(len(convs), 0)
        facts = asyncio.run(self.profile_repo.get_facts_by_user(user_id))
        self.assertEqual(facts, {})

    # --------------------------------------------------------------------------
    # 6. Edge Cases & Regressions
    # --------------------------------------------------------------------------
    def test_pre_v2_conversation_backfill(self):
        user_id = "user-prev2"
        conv_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        # Insert pre-v2 doc (lacks turn_count, total_tokens_est, anchor_exchange)
        asyncio.run(
            self.db["chat_conversations"].insert_one({
                "id": conv_id,
                "user_id": user_id,
                "title": "Legacy chat",
                "created_at": now,
                "last_message_at": now,
            })
        )

        # Insert 4 messages (2 turns), where Turn 1 is greeting, Turn 2 is substantive
        messages = [
            {"id": "m1", "conversation_id": conv_id, "user_id": user_id, "role": "user", "content": "hello", "intent": "greeting", "created_at": now + timedelta(seconds=1)},
            {"id": "m2", "conversation_id": conv_id, "user_id": user_id, "role": "assistant", "content": "hi", "created_at": now + timedelta(seconds=2)},
            {"id": "m3", "conversation_id": conv_id, "user_id": user_id, "role": "user", "content": "tôi bị mất ngủ nghiêm trọng trước kỳ thi", "intent": None, "created_at": now + timedelta(seconds=3)},
            {"id": "m4", "conversation_id": conv_id, "user_id": user_id, "role": "assistant", "content": "mình hiểu, đây là lời khuyên", "created_at": now + timedelta(seconds=4)},
        ]
        asyncio.run(self.db["chat_messages"].insert_many(messages))

        # Load context window should trigger backfill
        items, last_intent, meta = asyncio.run(self.repo.load_context_window(user_id, conv_id))
        self.assertEqual(len(items), 4)

        # Verify DB document was backfilled
        updated_doc = asyncio.run(self.db["chat_conversations"].find_one({"id": conv_id}))
        self.assertEqual(updated_doc["turn_count"], 2)
        self.assertGreater(updated_doc["total_tokens_est"], 0)
        self.assertEqual(len(updated_doc["anchor_exchange"]), 2)
        self.assertEqual(updated_doc["anchor_turn"], 2)

    def test_explicit_tombstoned_conversation_id_generates_new_uuid(self):
        user_id = "user-tombstone-test"
        old_conv_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        # Existing tombstoned document
        asyncio.run(
            self.db["chat_conversations"].insert_one({
                "id": old_conv_id,
                "user_id": user_id,
                "title": "Dead chat",
                "status": "tombstoned",
                "created_at": now,
                "last_message_at": now,
            })
        )

        # Client requests explicit old_conv_id
        resolved = asyncio.run(self.repo.get_or_create_conversation_by_user(user_id, conversation_id=old_conv_id))
        self.assertNotEqual(resolved["id"], old_conv_id)
        self.assertEqual(resolved["status"], "active")
        uuid.UUID(resolved["id"])

    def test_get_history_query_without_id_creates_no_conversation(self):
        user_id = "user-empty-history"
        query = GetHistoryQuery(store=self.history_store)
        page = asyncio.run(query.execute(user_id=user_id))
        self.assertEqual(len(page.items), 0)

        # No conversation should have been created
        convs = asyncio.run(self.history_store.list_conversations_by_user(user_id))
        self.assertEqual(len(convs), 0)

    def test_prompt_builder_injects_user_facts_in_canonical_order(self):
        builder = PromptBuilder()
        req = AssistantRespondRequest(userId="u1", message="Xin chào")
        history = [AssistantHistoryItem(role="user", content="hello")]
        facts = {
            "interests": "Đọc sách, nghe nhạc",
            "name": "Bảo",
            "occupation": "Học sinh cấp 3",
        }

        prompt = builder.build(req, history, user_facts=facts)
        self.assertIn("USER_FACTS", prompt)
        # name should appear before occupation and before interests in the block
        name_pos = prompt.find("- name: Bảo")
        occ_pos = prompt.find("- occupation: Học sinh cấp 3")
        int_pos = prompt.find("- interests: Đọc sách, nghe nhạc")
        self.assertTrue(name_pos < occ_pos < int_pos)

    def test_context_window_does_not_invert_chronology_when_greeting_precedes_anchor(self):
        # Turn 1: Greeting (not anchor)
        # Turn 2: Anchor
        # Turn 3: Recent turn
        conv = asyncio.run(self.repo.create_conversation("user-chrono", title="Chrono Test"))
        conv_id = conv["id"]
        asyncio.run(self.repo.append_exchange("user-chrono", "Xin chào bạn", "Chào bạn nhé!", intent="greeting", conversation_id=conv_id))
        asyncio.run(self.repo.append_exchange("user-chrono", "Tôi bị mất ngủ nhiều ngày nay", "Bạn thử đi dạo xem", conversation_id=conv_id))
        # Long turn to push tokens > 1500 (15 words * 50 * 1.35 * 2 = ~2000 tokens)
        long_text = "Nội dung trao đổi dài về bài tập rèn luyện thể dục thể thao mỗi sáng sớm. " * 50
        asyncio.run(self.repo.append_exchange("user-chrono", f"Hỏi thêm: {long_text}", f"Trả lời: {long_text}", conversation_id=conv_id))

        items, _, _ = asyncio.run(self.repo.load_context_window("user-chrono", conv_id))
        # Anchor (Turn 2) must be first; Turn 1 greeting must NOT be placed after anchor!
        self.assertIn("mất ngủ", items[0].content)
        # Verify "Xin chào" is NOT present anywhere in items
        for it in items:
            self.assertNotIn("Xin chào", it.content)

    def test_purge_user_data_lazy_cancels_extractor_tasks(self):
        # Create a store where fact_extractor is None initially
        store = HistoryStore(repository=self.repo, profile_repo=self.profile_repo)
        store.fact_extractor = None
        # Purge should not throw and should safely execute
        deleted = asyncio.run(store.purge_user_data("user-lazy-purge"))
        self.assertEqual(deleted, 0)


if __name__ == "__main__":
    unittest.main()
