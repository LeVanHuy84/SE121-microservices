import unittest

from app.modules.chatbot.schemas import SurfaceContext
from app.modules.chatbot.tools.catalog import ALL_TOOLS, DOMAIN_TOOLS, get_tool_by_name
from app.modules.chatbot.tools.router import (
    DEFAULT_ESSENTIAL_TOOLS,
    GLOBAL_TOOLS,
    MAX_ACTIVE_TOOLS,
    ToolRouter,
    tool_router,
)


class ToolCatalogAndRouterTest(unittest.TestCase):
    def test_catalog_contains_all_18_tools(self):
        self.assertEqual(len(ALL_TOOLS), 18)
        expected_domains = {"social", "groups", "emotions", "content", "account"}
        self.assertEqual(set(DOMAIN_TOOLS.keys()), expected_domains)

        for name, tool in ALL_TOOLS.items():
            self.assertEqual(tool.name, name)
            self.assertTrue(bool(tool.description))
            self.assertIn(tool.domain, expected_domains)
            self.assertTrue(bool(tool.target_service))
            openai_schema = tool.to_openai_tool()
            self.assertEqual(openai_schema["type"], "function")
            self.assertEqual(openai_schema["function"]["name"], name)
            self.assertIn("parameters", openai_schema["function"])

    def test_get_tool_by_name(self):
        self.assertIsNotNone(get_tool_by_name("get_my_friend_requests"))
        self.assertIsNotNone(get_tool_by_name("get_my_emotion_summary"))
        self.assertIsNone(get_tool_by_name("unregistered_tool_name"))

    def test_router_default_when_no_surface(self):
        tools = tool_router.route(None)
        self.assertLessEqual(len(tools), MAX_ACTIVE_TOOLS)
        tool_names = [t.name for t in tools]
        self.assertIn("get_my_friend_requests", tool_names)
        self.assertIn("get_my_groups", tool_names)
        self.assertIn("get_my_emotion_summary", tool_names)

    def test_router_for_emotions_surface(self):
        surface = SurfaceContext(screen="emotions.summary")
        tools = tool_router.route(surface)
        self.assertLessEqual(len(tools), MAX_ACTIVE_TOOLS)
        tool_names = [t.name for t in tools]
        self.assertIn("get_my_emotion_summary", tool_names)
        self.assertIn("get_my_emotion_trends", tool_names)
        self.assertIn("get_recommended_music_for_mood", tool_names)
        self.assertIn("get_mindfulness_exercises", tool_names)
        # Global tool included
        self.assertIn("get_my_unread_notifications", tool_names)

    def test_router_for_music_surface(self):
        surface = SurfaceContext(screen="music.discover")
        tools = tool_router.route(surface)
        tool_names = [t.name for t in tools]
        self.assertIn("get_recommended_music_for_mood", tool_names)
        self.assertLessEqual(len(tools), MAX_ACTIVE_TOOLS)

    def test_router_for_groups_surface(self):
        surface = SurfaceContext(screen="groups.detail", entityId="grp-123")
        tools = tool_router.route(surface)
        self.assertLessEqual(len(tools), MAX_ACTIVE_TOOLS)
        tool_names = [t.name for t in tools]
        self.assertIn("get_group_context", tool_names)
        self.assertIn("get_my_groups", tool_names)
        self.assertIn("get_group_invitations", tool_names)
        self.assertIn("get_group_recommendations", tool_names)
        self.assertIn("get_my_unread_notifications", tool_names)

    def test_router_for_friends_surface(self):
        surface = SurfaceContext(screen="friends.requests")
        tools = tool_router.route(surface)
        self.assertLessEqual(len(tools), MAX_ACTIVE_TOOLS)
        tool_names = [t.name for t in tools]
        self.assertIn("get_my_friend_requests", tool_names)
        self.assertIn("get_friend_recommendations", tool_names)
        self.assertIn("get_user_relationship", tool_names)
        self.assertIn("get_my_blocked_list", tool_names)

    def test_router_for_settings_surface(self):
        surface = SurfaceContext(screen="settings.privacy")
        tools = tool_router.route(surface)
        self.assertLessEqual(len(tools), MAX_ACTIVE_TOOLS)
        tool_names = [t.name for t in tools]
        self.assertIn("get_my_privacy_settings", tool_names)
        self.assertIn("get_my_moderation_history", tool_names)
        self.assertIn("get_my_unread_notifications", tool_names)

    def test_router_for_posts_feed_surface(self):
        surface = SurfaceContext(screen="posts.detail", entityId="post-456")
        tools = tool_router.route(surface)
        self.assertLessEqual(len(tools), MAX_ACTIVE_TOOLS)
        tool_names = [t.name for t in tools]
        self.assertIn("get_post_comments_summary", tool_names)
        self.assertIn("get_my_posts_overview", tool_names)
        self.assertIn("get_my_saved_posts", tool_names)

    def test_get_openai_tools_formatting(self):
        surface = SurfaceContext(screen="friends")
        schemas = tool_router.get_openai_tools(surface)
        self.assertIsInstance(schemas, list)
        self.assertGreater(len(schemas), 0)
        for schema in schemas:
            self.assertEqual(schema["type"], "function")
            self.assertIn("name", schema["function"])
            self.assertIn("parameters", schema["function"])


if __name__ == "__main__":
    unittest.main()
