from __future__ import annotations

from typing import Any

from app.modules.chatbot.schemas import SurfaceContext
from app.modules.chatbot.tools.catalog import (
    ALL_TOOLS,
    DOMAIN_TOOLS,
    GET_FRIEND_RECOMMENDATIONS,
    GET_MY_EMOTION_SUMMARY,
    GET_MY_FRIENDS,
    GET_MY_FRIEND_REQUESTS,
    GET_MY_GROUPS,
    GET_MY_UNREAD_NOTIFICATIONS,
    GET_TRENDING_POSTS,
    SEARCH_USERS,
    ToolDefinition,
)

MAX_ACTIVE_TOOLS = 6

GLOBAL_TOOLS: list[ToolDefinition] = [
    GET_MY_UNREAD_NOTIFICATIONS,
    GET_MY_EMOTION_SUMMARY,
]

DEFAULT_ESSENTIAL_TOOLS: list[ToolDefinition] = [
    GET_MY_FRIENDS,
    GET_MY_FRIEND_REQUESTS,
    GET_MY_GROUPS,
    GET_MY_EMOTION_SUMMARY,
    GET_MY_UNREAD_NOTIFICATIONS,
    GET_TRENDING_POSTS,
]


class ToolRouter:
    """Dynamically routes tool schemas to the LLM based on user's active surface screen.

    Strict invariant: Never returns more than MAX_ACTIVE_TOOLS (6) to guarantee sub-second
    inference latency and zero tool-calling hallucination.
    """

    def __init__(self, max_tools: int = MAX_ACTIVE_TOOLS):
        self.max_tools = max_tools

    def route(self, surface: SurfaceContext | None) -> list[ToolDefinition]:
        if surface is None or not surface.screen:
            return DEFAULT_ESSENTIAL_TOOLS[: self.max_tools]

        screen = surface.screen.lower()
        selected: list[ToolDefinition] = []

        if screen.startswith("emotions") or screen.startswith("music"):
            selected = self._compose_domain("emotions")
        elif screen.startswith("groups"):
            selected = self._compose_domain("groups")
        elif screen.startswith("friends") or screen.startswith("social"):
            selected = self._compose_domain("social")
        elif (
            screen.startswith("settings")
            or screen.startswith("privacy")
            or screen.startswith("moderation")
        ):
            selected = self._compose_domain("account")
        elif (
            screen.startswith("posts")
            or screen.startswith("feed")
            or screen.startswith("profile")
        ):
            selected = self._compose_domain("content")
        else:
            selected = list(DEFAULT_ESSENTIAL_TOOLS)

        # Deduplicate while preserving order and limit to max_tools
        deduped: list[ToolDefinition] = []
        seen: set[str] = set()
        for tool in selected:
            if tool.name not in seen:
                seen.add(tool.name)
                deduped.append(tool)
            if len(deduped) >= self.max_tools:
                break

        return deduped

    def _compose_domain(self, domain_name: str) -> list[ToolDefinition]:
        domain_tools = DOMAIN_TOOLS.get(domain_name, [])
        return list(domain_tools) + list(GLOBAL_TOOLS)

    def get_openai_tools(self, surface: SurfaceContext | None) -> list[dict[str, Any]]:
        tools = self.route(surface)
        return [tool.to_openai_tool() for tool in tools]


tool_router = ToolRouter()
