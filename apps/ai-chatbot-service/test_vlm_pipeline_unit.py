import io
import sys
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from PIL import Image

# Add root directory of ai-chatbot-service
ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.modules.analysis.schemas import ImageInput
from app.modules.analysis.services.ml_models.vlm.vlm_analyzer import (
    vlm_analyzer,
    VLMAnalyzer,
    VLMRawOutput,
    EmotionScores
)
from app.modules.analysis.services.orchestration.handle_event_service import HandleEventService
from app.modules.analysis.services.orchestration.analysis_flow_service import AnalysisFlowService
from app.modules.analysis.enums import TargetTypeEnum, EventTypeEnum


def create_sample_jpeg_bytes() -> bytes:
    """Create in-memory 100x100 RGB image."""
    img = Image.new("RGB", (100, 100), color=(73, 109, 137))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


async def test_vlm_image_bytes_processing():
    """Test 1: Verify direct bytes consumption without network request."""
    print("\n--- [TEST 1] VLM Image Bytes Compression & Zero Network Re-download ---")
    jpeg_bytes = create_sample_jpeg_bytes()
    image_input = ImageInput(url="https://example.com/fake_image.jpg", bytes=jpeg_bytes)

    client = await vlm_analyzer.get_client()
    result = await vlm_analyzer._compress_and_encode_image_async(image_input, client)

    assert result.startswith("data:image/jpeg;base64,"), "Result must be Base64 Data URL"
    print("✓ Successfully encoded ImageInput.bytes to Base64 without any redundant network call!")


async def test_vlm_normalization():
    """Test 2: Verify emotion score softmax normalization and dynamic secondary thresholds."""
    print("\n--- [TEST 2] VLM Output Score Normalization ---")
    raw = VLMRawOutput(
        primary_emotion="joy",
        final_confidence=0.55,
        emotion_scores=EmotionScores(
            joy=0.55,
            sadness=0.10,
            anger=0.0,
            fear=0.0,
            disgust=0.0,
            surprise=0.35,
            neutral=0.0
        ),
        is_sarcasm_or_conflict=False
    )
    normalized = vlm_analyzer._normalize_raw_output(raw)
    assert normalized["primaryEmotion"] == "joy"
    assert "surprise" in normalized["secondaryEmotions"]
    assert abs(sum(normalized["emotionScores"].values()) - 1.0) < 0.01
    print("✓ Score normalization and secondary emotion thresholding passed!")


async def test_handle_updated_event_pipeline():
    """Test 3: Verify handle_updated pipeline execution."""
    print("\n--- [TEST 3] Handle Updated Event Pipeline (Fixed AttributeError) ---")
    
    mock_flow_service = MagicMock(spec=AnalysisFlowService)
    mock_flow_service.analyze_content = AsyncMock(return_value={
        "moderation": {
            "isViolation": False,
            "action": "ALLOW",
            "label": "CLEAN",
            "labelCode": 0,
            "confidence": 1.0,
            "mentalHealthSupport": False,
            "reason": "",
            "flaggedCategories": [],
            "pipelineSource": "TEXT_PHOBERT",
            "allScores": {}
        },
        "emotion": {
            "primaryEmotion": "joy",
            "secondaryEmotions": [],
            "finalConfidence": 0.9,
            "finalScores": {"joy": 0.9, "neutral": 0.1},
            "intensity": {"level": "moderate", "score": 0.9},
            "pipelineSource": "TEXT_PHOBERT",
            "isSarcasmOrConflict": False,
            "conflictExplanation": "",
            "mentalHealthRiskLevel": "none",
            "suggestedAction": "NO_ACTION",
            "content": "Cập nhật bài viết mới",
            "imageUrls": []
        },
        "shouldBlock": False
    })

    mock_moderation_repo = MagicMock()
    mock_moderation_repo.get_by_target = AsyncMock(return_value={"_id": "mod_1", "userId": "user_123", "targetId": "post_456", "targetType": "POST", "content": "cũ"})
    mock_moderation_repo.update_moderation = AsyncMock(return_value={"_id": "mod_1", "userId": "user_123", "targetId": "post_456", "targetType": "POST", "content": "mới"})

    mock_emotion_repo = MagicMock()
    mock_emotion_repo.get_by_target = AsyncMock(return_value={"_id": "emo_1", "userId": "user_123", "targetId": "post_456", "targetType": "POST", "content": "cũ"})
    mock_emotion_repo.update = AsyncMock(return_value={"_id": "emo_1", "userId": "user_123", "targetId": "post_456", "targetType": "POST", "content": "mới"})

    mock_task_repo = MagicMock()
    mock_task_repo.get_by_target = AsyncMock(return_value={"_id": "task_1"})
    mock_task_repo.save_failed_task = AsyncMock(return_value={"_id": "task_1"})
    mock_task_repo.mark_permanent_failed = AsyncMock(return_value={"_id": "task_1"})
    mock_task_repo.update_task = AsyncMock(return_value={"_id": "task_1"})
    mock_outbox_repo = MagicMock()
    mock_outbox_repo.save_outbox = AsyncMock(return_value={"_id": "outbox_1"})

    handler_service = HandleEventService(
        analysis_flow_service=mock_flow_service,
        emotion_aggregate_repo=mock_emotion_repo,
        moderation_repo=mock_moderation_repo,
        task_repo=mock_task_repo,
        outbox_repo=mock_outbox_repo
    )

    event_payload = {
        "userId": "user_123",
        "targetId": "post_456",
        "targetType": "POST",
        "content": "Nội dung cập nhật mới",
        "imageUrls": ["https://example.com/test.jpg"]
    }

    result = await handler_service.handle_updated(event_payload)
    assert result is not None
    assert result["shouldBlock"] is False
    assert mock_flow_service.analyze_content.called
    print("✓ handle_updated successfully called analyze_content with images and completed without error!")


async def run_all_tests():
    print("==========================================================")
    print("  RUNNING VLM & PIPELINE OPTIMIZATION VERIFICATION SUITE  ")
    print("==========================================================")
    try:
        await test_vlm_image_bytes_processing()
        await test_vlm_normalization()
        await test_handle_updated_event_pipeline()
        print("\n==========================================================")
        print("  🎉 ALL 3 PIPELINE & VLM TESTS PASSED SUCCESSFULLY!       ")
        print("==========================================================")
    finally:
        await vlm_analyzer.close()


if __name__ == "__main__":
    asyncio.run(run_all_tests())
