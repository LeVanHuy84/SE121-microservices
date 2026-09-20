import asyncio
import json
import logging
from typing import Any

import aio_pika

from app.core.config import settings
from app.modules.chatbot.services.emotion_context import emotion_context_service

logger = logging.getLogger("uvicorn.error")

_rabbitmq_connection = None
_rabbitmq_channel = None

async def init_rabbitmq():
    """Initializes RabbitMQ connection and binds the consumer for proactive interventions."""
    global _rabbitmq_connection, _rabbitmq_channel
    
    # We use AMQP_URL from settings if it exists, otherwise fallback to local
    rabbitmq_url = getattr(settings, "RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
    
    try:
        _rabbitmq_connection = await aio_pika.connect_robust(rabbitmq_url)
        _rabbitmq_channel = await _rabbitmq_connection.channel()
        
        # Declare the exchange (matches emotion-intelligence-service: name='proactive.intervention')
        exchange = await _rabbitmq_channel.declare_exchange(
            name="proactive.intervention",
            type=aio_pika.ExchangeType.TOPIC,
            durable=False, # Often topic exchanges might be transient or defined by the publisher
            auto_delete=False,
        )
        
        # Declare an exclusive queue for this service instance to listen
        queue = await _rabbitmq_channel.declare_queue(
            name=f"chatbot-proactive-consumer-{settings.KAFKA_CLIENT_ID}",
            exclusive=True,
        )
        
        # Bind to the specific routing key
        await queue.bind(exchange, routing_key="notification.proactive")
        
        # Start consuming
        await queue.consume(handle_proactive_intervention)
        logger.info("[RabbitMQ] Successfully connected and bound to proactive.intervention exchange.")
        
    except Exception as exc:
        logger.error(f"[RabbitMQ] Failed to initialize RabbitMQ connection: {exc}", exc_info=True)


async def close_rabbitmq():
    global _rabbitmq_connection
    if _rabbitmq_connection:
        await _rabbitmq_connection.close()
        logger.info("[RabbitMQ] Connection closed.")


async def handle_proactive_intervention(message: aio_pika.abc.AbstractIncomingMessage):
    """
    Handles 'notification.proactive' events containing ProactiveInterventionDto.
    """
    async with message.process():
        try:
            body = message.body.decode("utf-8")
            data: dict[str, Any] = json.loads(body)
            
            user_id = data.get("userId")
            if not user_id:
                logger.warning("[RabbitMQ] Missing userId in proactive.intervention event")
                return
                
            risk_level = data.get("riskLevel", "none").lower()
            suggested_action = data.get("suggestedAction", "NO_ACTION")
            chatbot_prompt_context = data.get("chatbotPromptContext")
            
            # Update cache to inject the proactive context
            # We first try to fetch the existing snapshot to preserve the primary_emotion
            existing_snapshot = await emotion_context_service.get_snapshot(user_id)
            
            existing_snapshot.risk_level = risk_level
            existing_snapshot.suggested_action = suggested_action
            existing_snapshot.chatbot_prompt_context = chatbot_prompt_context
            
            await emotion_context_service.update_cache(user_id, existing_snapshot)
            logger.info(f"[RabbitMQ] Updated EmotionSnapshot cache for userId={user_id} with proactive checkin context.")
            
        except Exception as exc:
            logger.error(f"[RabbitMQ] Error processing proactive message: {exc}", exc_info=True)
