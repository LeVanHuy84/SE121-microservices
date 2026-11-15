import os
import unittest

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

from pydantic import ValidationError

from app.modules.chatbot.schemas import (
    ActionExecutionRequest,
    AssistantRespondData,
    AssistantRespondRequest,
    NavigateAction,
    NavigatePayload,
    ProposeActionPayload,
)


def _action(
    destination_id="settings.privacy", label="Quyền riêng tư"
) -> NavigateAction:
    return NavigateAction(
        label=label, payload=NavigatePayload(destinationId=destination_id)
    )


def _data(**kwargs) -> AssistantRespondData:
    base = dict(reply="ok", model="m", provider="p")
    base.update(kwargs)
    return AssistantRespondData(**base)


class NavigateActionSchemaTest(unittest.TestCase):
    def test_valid_action_gets_generated_id(self):
        action = _action()
        self.assertEqual(action.type, "navigate")
        self.assertTrue(action.id)

    def test_label_over_40_chars_rejected(self):
        with self.assertRaises(ValidationError):
            _action(label="x" * 41)

    def test_invalid_destination_ids_rejected(self):
        for bad in (
            "Settings.Privacy",
            "/settings/privacy",
            "https://evil.example",
            "a..b",
            "settings.",
            "",
        ):
            with self.subTest(destination_id=bad), self.assertRaises(ValidationError):
                _action(destination_id=bad)

    def test_more_than_three_actions_rejected(self):
        with self.assertRaises(ValidationError):
            _data(type="navigation", suggestedActions=[_action() for _ in range(4)])

    def test_three_actions_allowed(self):
        data = _data(type="navigation", suggestedActions=[_action() for _ in range(3)])
        self.assertEqual(len(data.suggestedActions), 3)

    def test_crisis_with_actions_rejected(self):
        with self.assertRaises(ValidationError):
            _data(type="crisis", suggestedActions=[_action()])

    def test_crisis_without_actions_allowed(self):
        self.assertEqual(_data(type="crisis").suggestedActions, [])

    def test_propose_action_and_execution_request_require_proposal_token_and_default_restricted(
        self,
    ):
        req_default = AssistantRespondRequest(userId="u-1", message="hi")
        self.assertEqual(req_default.aiPolicy, "RESTRICTED")

        with self.assertRaises(ValidationError):
            ProposeActionPayload(
                actionId="a1",
                actionName="react_post",
                title="Like",
                description="Like post",
                params={"post_id": "p1"},
                idempotencyKey="idem-1",
            )

        with self.assertRaises(ValidationError):
            ActionExecutionRequest(
                actionId="a1",
                actionName="react_post",
                params={"post_id": "p1"},
                idempotencyKey="idem-1",
            )

        exec_req = ActionExecutionRequest(
            actionId="a1",
            actionName="react_post",
            params={"post_id": "p1"},
            idempotencyKey="idem-1",
            proposalToken="tok-123",
            conversationId="conv-1",
        )
        self.assertEqual(exec_req.aiPolicy, "RESTRICTED")


if __name__ == "__main__":
    unittest.main()
