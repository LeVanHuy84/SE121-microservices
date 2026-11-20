"""Unit tests for Navigation vs Data Retrieval Intent Disambiguation (Task 7).

Ensures:
1. Data retrieval queries ("Cho tôi biết", "Liệt kê", "Có bao nhiêu", etc.) are NOT hijacked
   by NavResolver as screen navigation commands (path != "command").
2. Direct navigation commands ("Mở", "Đi tới", "Vào", etc.) properly resolve to path="command".
3. Accuracy across both accented Vietnamese and unaccented Vietnamese.
"""

from __future__ import annotations

import unittest

from app.modules.chatbot.navigation.catalog import destination_catalog
from app.modules.chatbot.navigation.policy import build_nav_outcome
from app.modules.chatbot.navigation.resolver import NavResolver


class TestIntentDisambiguation(unittest.TestCase):
    def setUp(self):
        self.resolver = NavResolver(destination_catalog)

    def test_data_retrieval_intents_not_intercepted_as_navigation(self):
        queries = [
            "Cho tôi biết danh sách bạn bè",
            "cho toi biet danh sach ban be",
            "Liệt kê danh sách bạn bè của tôi",
            "liet ke ban be",
            "Có bao nhiêu bạn bè đang hoạt động",
            "co bao nhieu thong bao chua doc",
            "những ai đang là bạn bè của tôi",
            "danh sách gồm những ai",
            "tell me my friends list",
            "list all my groups",
            "how many notifications do I have",
        ]
        for query in queries:
            with self.subTest(query=query):
                decision = self.resolver.resolve(query, ai_policy="FULL")
                # Must NOT be a direct navigation command
                self.assertNotEqual(
                    decision.path,
                    "command",
                    f"Data retrieval query was wrongly hijacked as navigation command: '{query}'",
                )
                outcome = build_nav_outcome(decision, ai_policy="FULL")
                self.assertIsNone(
                    outcome.response,
                    f"Data retrieval query must not produce direct navigation short-circuit response: '{query}'",
                )

    def test_navigation_commands_properly_resolved_as_command(self):
        commands = [
            ("Mở trang bạn bè", "friends"),
            ("mo trang ban be", "friends"),
            ("Đi tới danh sách bạn bè", "friends"),
            ("di toi ban be", "friends"),
            ("Vào cài đặt quyền riêng tư", "settings.privacy"),
            ("chuyen den loi moi ket ban", "friends.requests"),
            ("open friends page", "friends"),
            ("go to settings", "settings"),
        ]
        for query, expected_dest in commands:
            with self.subTest(query=query):
                decision = self.resolver.resolve(query, ai_policy="FULL")
                self.assertEqual(
                    decision.path,
                    "command",
                    f"Navigation query failed to resolve as command: '{query}'",
                )
                self.assertTrue(len(decision.matches) > 0)
                self.assertEqual(decision.matches[0].destination_id, expected_dest)
                outcome = build_nav_outcome(decision, ai_policy="FULL")
                self.assertIsNotNone(
                    outcome.response,
                    f"Navigation command must produce direct navigation response: '{query}'",
                )
                self.assertEqual(outcome.response.type, "navigation")

    def test_howto_guidance_preserved(self):
        howto_queries = [
            ("Làm sao để tìm bạn mới", "friends.suggestions"),
            ("lam sao de xem danh sach ban be", "friends"),
            ("hướng dẫn mở chặn người khác", "friends.blocked"),
        ]
        for query, expected_dest in howto_queries:
            with self.subTest(query=query):
                decision = self.resolver.resolve(query, ai_policy="FULL")
                self.assertEqual(
                    decision.path,
                    "howto",
                    f"Howto query failed to resolve as howto: '{query}'",
                )
                self.assertTrue(
                    any(m.destination_id == expected_dest for m in decision.matches),
                    f"Expected destination '{expected_dest}' in matches for '{query}'",
                )
                outcome = build_nav_outcome(decision, ai_policy="FULL")
                self.assertIsNone(outcome.response)
                self.assertTrue(len(outcome.howto_actions) > 0)


if __name__ == "__main__":
    unittest.main()
