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
    PROPOSE_ACCOUNT_ACTION,
    ToolDefinition,
)
from app.utils.text_normalizer import normalize_for_guard

MAX_ACTIVE_TOOLS = 6
SURFACE_SLOT_QUOTA = 2
INTENT_SLOT_QUOTA = 3
GLOBAL_SLOT_QUOTA = 1

_ACTIONABLE_DOMAINS: frozenset[str] = frozenset({"social", "groups", "account"})
_MENTAL_HEALTH_TOOL_CUES: tuple[str, ...] = (
    "nhac",
    "bai hat",
    "am nhac",
    "playlist",
    "nghe nhac",
    "music",
    "bai tap",
    "hit tho",
    "chanh niem",
    "thien",
    "thu gian",
    "mindfulness",
    "xu huong",
    "thong ke",
    "bieu do",
    "tom tat cam xuc",
    "lich su cam xuc",
    "cam xuc 7 ngay",
    "emotion summary",
    "emotion trend",
)

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
        *,
        distress_level: str = "none",
        is_mental_health_turn: bool = False,
        message: str = "",
        include_action_proposal_tool: bool = False,
    ) -> list[ToolDefinition]:
        policy = str(ai_policy or "RESTRICTED").upper()

        # Empathy / PFA isolation: never attach tools on acute PFA turns, and skip
        # tools on pure mental-health venting turns unless the user asks for music,
        # exercises, or emotion analytics.
        if distress_level == "acute_pfa":
            return []
        if is_mental_health_turn and message:
            norm_msg = normalize_for_guard(message)
            if not any(cue in norm_msg for cue in _MENTAL_HEALTH_TOOL_CUES):
                return []

        mapped_intent_domains: list[str] = []
        tier1_tools: list[ToolDefinition] = []
        for domain in matched_domains or ():
            mapped_key = _INTENT_DOMAIN_MAP.get(str(domain).lower())
            if mapped_key:
                mapped_intent_domains.append(mapped_key)
                tier1_tools.extend(DOMAIN_TOOLS.get(mapped_key, []))

        tier2_tools: list[ToolDefinition] = []
        surface_domain = self._resolve_surface_domain(surface)
        if surface_domain:
            tier2_tools.extend(DOMAIN_TOOLS.get(surface_domain, []))

        global_tools = [
            tool
            for tool in GLOBAL_TOOLS
            if not (is_system_turn and tool.name == GET_MY_EMOTION_SUMMARY.name)
        ]

        def _filter_allowed(tools: list[ToolDefinition]) -> list[ToolDefinition]:
            out = tools
            if is_system_turn:
                out = [t for t in out if t.name != GET_MY_EMOTION_SUMMARY.name]
            if policy != "FULL":
                out = [t for t in out if t.policy_scope == "public"]
            return out

        tier1_allowed = _filter_allowed(tier1_tools)
        tier2_allowed = _filter_allowed(tier2_tools)
        global_allowed = _filter_allowed(global_tools)

        should_attach_action_tool = policy == "FULL" and bool(
            include_action_proposal_tool
        )

        # Reserve 1 slot for propose_account_action when eligible
        read_budget = (
            max(self.max_tools - 1, 0) if should_attach_action_tool else self.max_tools
        )

        selected: list[ToolDefinition] = []
        seen: set[str] = set()

        def _take(pool: list[ToolDefinition], limit: int) -> None:
            added = 0
            for tool in pool:
                if len(selected) >= read_budget or added >= limit:
                    break
                if tool.name not in seen:
                    seen.add(tool.name)
                    selected.append(tool)
                    added += 1

        if not tier1_tools and not tier2_tools:
            _take(_filter_allowed(list(DEFAULT_ESSENTIAL_TOOLS)), read_budget)
        else:
            # Structured quota: 2 surface + 3 intent + 1 global
            _take(tier2_allowed, SURFACE_SLOT_QUOTA)
            _take(tier1_allowed, INTENT_SLOT_QUOTA)
            _take(global_allowed, GLOBAL_SLOT_QUOTA)
            # Spill remaining budget to intent -> surface -> global
            if len(selected) < read_budget:
                _take(tier1_allowed, read_budget - len(selected))
            if len(selected) < read_budget:
                _take(tier2_allowed, read_budget - len(selected))
            if len(selected) < read_budget:
                _take(global_allowed, read_budget - len(selected))

        if should_attach_action_tool and len(selected) < self.max_tools:
            if PROPOSE_ACCOUNT_ACTION.name not in seen:
                selected.append(PROPOSE_ACCOUNT_ACTION)

        return selected

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
        *,
        distress_level: str = "none",
        is_mental_health_turn: bool = False,
        message: str = "",
        include_action_proposal_tool: bool = False,
    ) -> list[dict[str, Any]]:
        tools = self.route(
            surface,
            matched_domains=matched_domains,
            ai_policy=ai_policy,
            is_system_turn=is_system_turn,
            distress_level=distress_level,
            is_mental_health_turn=is_mental_health_turn,
            message=message,
            include_action_proposal_tool=include_action_proposal_tool,
        )
        return [tool.to_openai_tool() for tool in tools]


tool_router = ToolRouter()
