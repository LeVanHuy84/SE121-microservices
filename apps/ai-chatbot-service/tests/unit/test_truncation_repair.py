"""Unit tests for sentence completion and truncation repair helpers."""

import unittest
from app.modules.chatbot.services.assistant_support.turn_helpers import (
    is_incomplete_sentence,
    repair_truncated_text,
)


class TestTruncationRepair(unittest.TestCase):
    def test_complete_sentence_not_flagged(self):
        cases = [
            "Đây là một câu hoàn chỉnh.",
            "Bạn có khỏe không?",
            "Hãy cố gắng lên nhé!",
            "Mọi chuyện rồi sẽ ổn thôi...",
            'Đoạn văn kết thúc bằng trích dẫn: "Đúng vậy."',
        ]
        for text in cases:
            with self.subTest(text=text):
                self.assertFalse(
                    is_incomplete_sentence(text),
                    f"Expected '{text}' to be marked complete",
                )
                self.assertEqual(repair_truncated_text(text), text)

    def test_short_text_not_flagged(self):
        # Very short phrases like "Chào bạn", "Ok" shouldn't trigger truncation logic
        self.assertFalse(is_incomplete_sentence("Chào bạn"))
        self.assertFalse(is_incomplete_sentence("Ok"))
        self.assertFalse(is_incomplete_sentence(""))

    def test_incomplete_sentence_flagged_and_repaired_at_boundary(self):
        truncated = "Mình rất hiểu cảm xúc lo lắng của bạn lúc này. Bạn có thể thử nghe một bản nhạc nhẹ nhàng hoặc"
        self.assertTrue(is_incomplete_sentence(truncated))
        repaired = repair_truncated_text(truncated)
        self.assertTrue(
            repaired.endswith("."),
            f"Expected repaired text to end with period, got: '{repaired}'",
        )
        self.assertEqual(
            repaired,
            "Mình rất hiểu cảm xúc lo lắng của bạn lúc này.",
        )

    def test_incomplete_sentence_without_prior_boundary_appends_ellipsis(self):
        single_long_clause = (
            "Khi bạn cảm thấy quá tải và không biết phải bắt đầu từ đâu trong công việc"
        )
        self.assertTrue(is_incomplete_sentence(single_long_clause))
        repaired = repair_truncated_text(single_long_clause)
        self.assertTrue(repaired.endswith("..."))
        self.assertTrue(repaired.startswith(single_long_clause))


if __name__ == "__main__":
    unittest.main()
