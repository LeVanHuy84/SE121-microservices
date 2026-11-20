from __future__ import annotations

from typing import Any, Iterable

from app.modules.chatbot.schemas import SurfaceContext
from app.modules.chatbot.tools.catalog import (
    DOMAIN_TOOLS,
    GET_MY_EMOTION_SUMMARY,
    GET_MY_FRIENDS,
    GET_MY_FRIEND_REQUESTS,
    GET_MY_GROUPS,
    GET_MY_UNREAD_NOTIFICATIONS,
    GET_TRENDING_POSTS,
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

_INTENT_DOMAIN_MAP: dict[str, str] = {
    "mental_health": "emotions",
    "emotion": "emotions",
    "group": "groups",
    "user_social": "social",
    "social": "social",
    "privacy": "account",
    "settings_support": "account",
    "auth": "account",
    "post": "content",
    "search": "content",
}


class ToolRouter:
    """Dynamically routes tool schemas to the LLM using 2-tier intent + surface routing.

    Strict invariant: Never returns more than MAX_ACTIVE_TOOLS (6) to guarantee sub-second
    inference latency and zero tool-calling hallucination.
    """

    def __init__(self, max_tools: int = MAX_ACTIVE_TOOLS):
        self.max_tools = max_tools

    def route(
        self,
        surface: SurfaceContext | None,
        matched_domains: Iterable[str] | None = None,
        ai_policy: str = "RESTRICTED",
        is_system_turn: bool = False,
    ) -> list[ToolDefinition]:
        policy = str(ai_policy or "RESTRICTED").upper()
        tier1_tools: list[ToolDefinition] = []
        for domain in matched_domains or ():
            mapped_key = _INTENT_DOMAIN_MAP.get(str(domain).lower())
            if mapped_key:
                tier1_tools.extend(DOMAIN_TOOLS.get(mapped_key, []))

        tier2_tools: list[ToolDefinition] = []
        surface_domain = self._resolve_surface_domain(surface)
        if surface_domain:
            tier2_tools.extend(DOMAIN_TOOLS.get(surface_domain, []))

        if not tier1_tools and not tier2_tools:
            selected = list(DEFAULT_ESSENTIAL_TOOLS)
        else:
            global_tools = [
                tool
                for tool in GLOBAL_TOOLS
                if not (is_system_turn and tool.name == GET_MY_EMOTION_SUMMARY.name)
            ]
            selected = tier1_tools + tier2_tools + global_tools

        if is_system_turn:
            selected = [
                tool for tool in selected if tool.name != GET_MY_EMOTION_SUMMARY.name
            ]

        if policy != "FULL":
            selected = [tool for tool in selected if tool.policy_scope == "public"]

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

    def _resolve_surface_domain(self, surface: SurfaceContext | None) -> str | None:
        if surface is None or not surface.screen:
            return None
        screen = surface.screen.lower()
        if screen.startswith("emotions") or screen.startswith("music"):
            return "emotions"
        if screen.startswith("groups"):
            return "groups"
        if screen.startswith("friends") or screen.startswith("social"):
            return "social"
        if (
            screen.startswith("settings")
            or screen.startswith("privacy")
            or screen.startswith("moderation")
        ):
            return "account"
        if (
            screen.startswith("posts")
            or screen.startswith("feed")
            or screen.startswith("profile")
        ):
            return "content"
        return None

    def get_openai_tools(
        self,
        surface: SurfaceContext | None,
        matched_domains: Iterable[str] | None = None,
        ai_policy: str = "RESTRICTED",
        is_system_turn: bool = False,
    ) -> list[dict[str, Any]]:
        tools = self.route(
            surface,
            matched_domains=matched_domains,
            ai_policy=ai_policy,
            is_system_turn=is_system_turn,
        )
        return [tool.to_openai_tool() for tool in tools]


tool_router = ToolRouter()
