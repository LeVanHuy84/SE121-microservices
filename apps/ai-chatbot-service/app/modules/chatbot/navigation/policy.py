from __future__ import annotations

from dataclasses import dataclass, field

from app.modules.chatbot.navigation.resolver import NavDecision, NavMatch
from app.modules.chatbot.schemas import AssistantRespondData, NavigateAction, NavigatePayload

_HOWTO_MAX_ACTIONS = 2
_CLARIFY_MAX_ACTIONS = 3
_NAV_MODEL = "nav-resolver"
_NAV_PROVIDER = "chatbot-service"


@dataclass(frozen=True, slots=True)
class NavOutcome:
    """What the assistant should do with a resolved navigation intent.

    - `response` set: answer the turn directly (no LLM) with `intent` as the stored intent.
    - `howto_actions` set: let RAG + LLM answer, then attach these buttons.
    - Neither: not a navigation turn.
    """

    path: str = "none"
    response: AssistantRespondData | None = None
    intent: str | None = None
    howto_actions: list[NavigateAction] = field(default_factory=list)

    @property
    def offered_actions(self) -> list[NavigateAction]:
        if self.response is not None:
            return list(self.response.suggestedActions)
        return list(self.howto_actions)


def to_action(match: NavMatch) -> NavigateAction:
    return NavigateAction(
        label=match.label_vi,
        payload=NavigatePayload(destinationId=match.destination_id, params=match.params),
    )


def _direct_response(response_type: str, reply: str, actions: list[NavigateAction]) -> AssistantRespondData:
    return AssistantRespondData(
        type=response_type,
        reply=reply,
        sources=[],
        suggestedActions=actions,
        model=_NAV_MODEL,
        provider=_NAV_PROVIDER,
    )


def build_nav_outcome(decision: NavDecision) -> NavOutcome:
    """Pure mapping from a NavDecision to the assistant behaviour (no I/O)."""
    if not decision.matches:
        return NavOutcome()

    if decision.path == "command":
        top = decision.matches[0]
        reply = decision.suggested_reply or f"Chuyển tới {top.label_vi}"
        return NavOutcome(
            path="command",
            response=_direct_response("navigation", reply, [to_action(top)]),
            intent="navigation",
        )

    if decision.path == "clarify":
        actions = [to_action(m) for m in decision.matches[:_CLARIFY_MAX_ACTIONS]]
        reply = decision.suggested_reply or "Bạn muốn chuyển đến màn hình nào dưới đây?"
        return NavOutcome(
            path="clarify",
            response=_direct_response("clarify", reply, actions),
            intent="clarify",
        )

    if decision.path == "howto":
        return NavOutcome(
            path="howto",
            howto_actions=[to_action(m) for m in decision.matches[:_HOWTO_MAX_ACTIONS]],
        )

    return NavOutcome()
