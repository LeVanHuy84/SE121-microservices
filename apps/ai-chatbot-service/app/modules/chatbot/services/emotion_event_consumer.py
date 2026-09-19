import json
import logging

from app.modules.chatbot.services.emotion_context import EmotionSnapshot, emotion_context_service

logger = logging.getLogger("uvicorn.error")

async def handle_analysis_result(msg: dict):
    """
    Handles messages from the analysis-result-events topic.
    Payload: { userId, moderation: {...}, emotion: {...} }
    """
    try:
        if not msg:
            return

        payload = msg.get("payload", {})
        user_id = payload.get("userId")
        if not user_id:
            return

        # Extract emotion data (merged at the root of the payload in the Outbox event)
        primary_emotion = payload.get("primaryEmotion")
        if not primary_emotion:
            return # If primaryEmotion is missing, this event doesn't contain emotion analysis results
            
        primary_emotion = primary_emotion.lower()
        risk_level = payload.get("mentalHealthRiskLevel", "none").lower()
        
        # If risk_level is high/medium, trigger proactive check-in (same logic as MongoDB pipeline)
        suggested_action = "NO_ACTION"
        if risk_level in ["medium", "high"]:
            suggested_action = "TRIGGER_PROACTIVE_CHECKIN"

        snapshot = EmotionSnapshot(
            primary_emotion=primary_emotion,
            risk_level=risk_level,
            suggested_action=suggested_action,
        )

        # Save directly to Redis
        await emotion_context_service.update_cache(user_id, snapshot)
        logger.debug("[EmotionEventConsumer] Updated Redis cache for userId=%s with emotion=%s", user_id, primary_emotion)

    except Exception as exc:
        logger.error("[EmotionEventConsumer] Failed to handle analysis result: %s", exc, exc_info=True)
