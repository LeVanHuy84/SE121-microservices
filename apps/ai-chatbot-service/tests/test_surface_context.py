import unittest
from pydantic import ValidationError

from app.modules.chatbot.schemas import (
    AssistantHistoryItem,
    AssistantRespondRequest,
    SurfaceContext,
)
from app.modules.chatbot.services.prompt_builder import PromptBuilder


class TestSurfaceContext(unittest.TestCase):
    def test_surface_context_schema_valid(self):
        surface = SurfaceContext(
            screen="groups.my_groups",
            entityId="grp-12345",
            metadata={"tab": "members", "role": "admin"},
        )
        self.assertEqual(surface.screen, "groups.my_groups")
        self.assertEqual(surface.entityId, "grp-12345")
        self.assertEqual(surface.metadata["role"], "admin")

    def test_surface_context_schema_validation_error(self):
        # Invalid screen format (contains spaces or uppercase or illegal symbols)
        with self.assertRaises(ValidationError):
            SurfaceContext(screen="Invalid Screen Name!")

    def test_prompt_builder_injects_surface_context(self):
        builder = PromptBuilder()
        request = AssistantRespondRequest(
            userId="user_123",
            message="Nhóm này có bao nhiêu thành viên vậy?",
            surface=SurfaceContext(
                screen="groups.explore",
                entityId="group-ai-enthusiasts",
                metadata={"category": "technology"},
            ),
        )

        prompt = builder.build(
            request=request,
            history=[
                AssistantHistoryItem(role="user", content="Chào bạn"),
                AssistantHistoryItem(role="assistant", content="Chào bạn, mình có thể giúp gì?"),
            ],
        )

        self.assertIn("SURFACE_CONTEXT (Ngữ cảnh màn hình hiện tại của người dùng):", prompt)
        self.assertIn("- Màn hình đang mở: groups.explore", prompt)
        self.assertIn("- Thực thể đang xem: group-ai-enthusiasts", prompt)
        self.assertIn("category=technology", prompt)

    def test_prompt_builder_omits_surface_context_when_none(self):
        builder = PromptBuilder()
        request = AssistantRespondRequest(
            userId="user_123",
            message="Hôm nay tâm trạng tôi khá ổn",
            surface=None,
        )

        prompt = builder.build(request=request, history=[])
        self.assertNotIn("SURFACE_CONTEXT", prompt)


if __name__ == "__main__":
    unittest.main()
