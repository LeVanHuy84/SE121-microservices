import pytest
from pydantic import ValidationError

from app.modules.chatbot.schemas import (
    AssistantHistoryItem,
    AssistantRespondRequest,
    SurfaceContext,
)
from app.modules.chatbot.services.prompt_builder import PromptBuilder


def test_surface_context_schema_valid():
    surface = SurfaceContext(
        screen="groups.my_groups",
        entityId="grp-12345",
        metadata={"tab": "members", "role": "admin"},
    )
    assert surface.screen == "groups.my_groups"
    assert surface.entityId == "grp-12345"
    assert surface.metadata["role"] == "admin"


def test_surface_context_schema_validation_error():
    # Invalid screen format (contains spaces or uppercase or illegal symbols)
    with pytest.raises(ValidationError):
        SurfaceContext(screen="Invalid Screen Name!")


def test_prompt_builder_injects_surface_context():
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

    assert "SURFACE_CONTEXT (Ngữ cảnh màn hình hiện tại của người dùng):" in prompt
    assert "- Màn hình đang mở: groups.explore" in prompt
    assert "- Thực thể đang xem: group-ai-enthusiasts" in prompt
    assert "category=technology" in prompt


def test_prompt_builder_omits_surface_context_when_none():
    builder = PromptBuilder()
    request = AssistantRespondRequest(
        userId="user_123",
        message="Hôm nay tâm trạng tôi khá ổn",
        surface=None,
    )

    prompt = builder.build(request=request, history=[])
    assert "SURFACE_CONTEXT" not in prompt
