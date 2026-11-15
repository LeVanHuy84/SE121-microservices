import logging

from app.modules.chatbot.services.emotion_context import emotion_context_service

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
            return  # If primaryEmotion is missing, this event doesn't contain emotion analysis results

        primary_emotion = primary_emotion.lower()
        risk_level = payload.get("mentalHealthRiskLevel", "none").lower()

        # Write only acute post emotion to chatbot:emotion:acute:{user_id}
        await emotion_context_service.update_acute_cache(
            user_id,
            acute_emotion=primary_emotion,
            acute_risk_level=risk_level,
        )
        logger.debug(
            "[EmotionEventConsumer] Updated acute Redis hash for userId=%s with emotion=%s",
            user_id,
            primary_emotion,
        )

    except Exception as exc:
        logger.error(
            "[EmotionEventConsumer] Failed to handle analysis result: %s",
            exc,
            exc_info=True,
        )
