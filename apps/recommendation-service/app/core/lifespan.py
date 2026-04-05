import asyncio
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    try:
        logger.info("Starting recommendation-service")
        from app.services.model_loader import model_loader

        await asyncio.get_event_loop().run_in_executor(None, model_loader.warmup)
        logger.info("Recommendation model warmed up")
        yield
    finally:
        logger.info("Stopping recommendation-service")
