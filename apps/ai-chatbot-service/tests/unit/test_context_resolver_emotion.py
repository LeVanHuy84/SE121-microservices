import unittest
from app.modules.chatbot.schemas import AssistantContextItem
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.context_resolver import AssistantContextResolver


class TestContextResolverEmotion(unittest.TestCase):
    def test_emotion_aware_boosting(self):
        resolver = AssistantContextResolver()

        # Base items with same score
        contexts = [
            AssistantContextItem(id="1", type="help_doc", title="Sơ cứu tâm lý", content="PFA content", score=1.0, source="rag", metadata={"topic": "pfa"}),
            AssistantContextItem(id="2", type="help_doc", title="Thở 4-7-8", content="CBT content", score=1.0, source="rag", metadata={"topic": "phuong-phap-chua-tri"}),
            AssistantContextItem(id="3", type="help_doc", title="Đại cương", content="Academic", score=1.0, source="rag", metadata={"topic": "giao-trinh-chuyen-nganh"}),
        ]

        # 1. High risk -> pfa boosted
        high_risk_snapshot = EmotionSnapshot(primary_emotion="fear", risk_level="high")
        ranked = resolver._rank_contexts("test query", contexts, high_risk_snapshot)

        self.assertEqual(ranked[0].id, "1")  # PFA heavily boosted
        self.assertEqual(ranked[1].id, "2")  # Phương pháp boosted slightly due to negative emotion
        self.assertEqual(ranked[2].id, "3")  # Giao trinh depressed

        # 2. Sadness but no risk -> phuong phap chua tri boosted
        sad_snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="none")
        ranked2 = resolver._rank_contexts("test query", contexts, sad_snapshot)

        self.assertEqual(ranked2[0].id, "2")  # CBT/self-care boosted
        self.assertEqual(ranked2[2].id, "3")  # Giao trinh depressed

        # 3. Neutral -> just lexical score
        neutral_snapshot = EmotionSnapshot(primary_emotion="neutral", risk_level="none")
        ranked3 = resolver._rank_contexts("test query", contexts, neutral_snapshot)

        # No emotion boost, fallback to original score/lexical
        self.assertEqual(len(ranked3), 3)
