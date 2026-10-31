import os
import unittest

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

from pydantic import ValidationError

from app.modules.chatbot.schemas import AssistantRespondData, NavigateAction, NavigatePayload


def _action(destination_id="settings.privacy", label="Quyền riêng tư") -> NavigateAction:
    return NavigateAction(label=label, payload=NavigatePayload(destinationId=destination_id))


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
        for bad in ("Settings.Privacy", "/settings/privacy", "https://evil.example", "a..b", "settings.", ""):
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


if __name__ == "__main__":
    unittest.main()
