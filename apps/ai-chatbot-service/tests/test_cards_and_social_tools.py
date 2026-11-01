import unittest
from unittest.mock import AsyncMock

from app.modules.chatbot.schemas import (
    CardPayload,
    ShowCardAction,
    AssistantRespondData,
    AssistantRespondRequest,
    SurfaceContext,
)
from app.modules.chatbot.services.assistant import RespondCommand
from app.modules.chatbot.tools.dispatcher import ToolExecutionContext, ToolExecutionResult
from app.modules.chatbot.tools.handlers import MicroserviceToolHandlers


class CardsAndSocialToolsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.mock_http = AsyncMock()
        self.handlers = MicroserviceToolHandlers(self.mock_http)
        self.ctx = ToolExecutionContext(
            user_id="user-123",
            surface=SurfaceContext(screen="social.friends"),
            auth_token="jwt-token",
        )

    async def test_get_my_friends_handler(self):
        self.mock_http.get.return_value = {
            "total": 25,
            "data": [
                {"id": "u-1", "name": "Vinh Co", "username": "vinhco", "avatarUrl": "https://example.com/a.jpg"},
                {"id": "u-2", "name": "Minh Tran", "username": "minhtran", "avatarUrl": None},
            ],
        }
        res = await self.handlers.get_my_friends({"limit": 5}, self.ctx)
        self.assertEqual(res["total"], 25)
        self.assertEqual(len(res["friends"]), 2)
        self.mock_http.get.assert_called_once_with(
            "/social/friends/me",
            params={"limit": 5},
            auth_token="jwt-token",
        )

    async def test_search_users_handler(self):
        self.mock_http.get.return_value = [
            {"id": "u-3", "name": "Nam Nguyen", "username": "namnguyen", "avatarUrl": None}
        ]
        res = await self.handlers.search_users({"query": "Nam"}, self.ctx)
        self.assertEqual(res["total"], 1)
        self.assertEqual(res["users"][0]["name"], "Nam Nguyen")
        self.mock_http.get.assert_called_once_with(
            "/search/users",
            params={"q": "Nam", "limit": 3},
            auth_token="jwt-token",
        )

    async def test_get_trending_posts_handler_and_truncation(self):
        long_content = "Bài viết rất dài " * 30
        self.mock_http.get.return_value = {
            "data": [
                {
                    "id": "post-99",
                    "content": long_content,
                    "author": {"name": "Báo Trí Tuệ"},
                    "reactionCount": 50,
                    "commentCount": 12,
                }
            ]
        }
        res = await self.handlers.get_trending_posts({"limit": 3}, self.ctx)
        self.assertEqual(len(res["posts"]), 1)
        post = res["posts"][0]
        self.assertEqual(post["id"], "post-99")
        self.assertEqual(post["authorName"], "Báo Trí Tuệ")
        self.assertTrue(len(post["content"]) <= 125)
        self.assertTrue(post["content"].endswith("..."))

    def test_extract_cards_logic(self):
        cmd = RespondCommand()
        # Mock tool call & result
        class DummyTC:
            name = "get_my_friends"

        result = ToolExecutionResult(
            tool_name="get_my_friends",
            success=True,
            data={
                "total": 10,
                "friends": [
                    {"id": "u-1", "name": "Vinh Co", "username": "vinhco", "avatarUrl": "https://img.com/1.png"}
                ],
            },
        )
        cards = cmd._extract_cards((DummyTC(),), [result])
        self.assertEqual(len(cards), 1)
        card = cards[0]
        self.assertEqual(card.type, "show_card")
        self.assertEqual(card.payload.cardType, "profile")
        self.assertEqual(card.payload.title, "Vinh Co")
        self.assertEqual(card.payload.actionUrl, "/profile/vinhco")

    def test_crisis_guard_still_rejects_cards(self):
        with self.assertRaises(ValueError):
            AssistantRespondData(
                type="crisis",
                reply="Hỗ trợ khẩn cấp",
                model="test",
                provider="test",
                cards=[
                    ShowCardAction(
                        label="Xem",
                        payload=CardPayload(cardType="profile", title="Test"),
                    )
                ],
            )
