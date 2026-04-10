import asyncio
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    from app.bootstrap import messaging_runtime, state_repository
    from app.services.model_loader import model_loader

    try:
        logger.info("Starting recommendation-service")

        state_repository.validate_connection()
        state_repository.validate_schema()
        logger.info("Recommendation state repository connected and schema validated")
        await asyncio.get_running_loop().run_in_executor(None, model_loader.warmup)
        logger.info("Recommendation model warmed up")
        await messaging_runtime.start()
        logger.info("Recommendation messaging and processor started")
        yield
    except Exception as exc:
        logger.exception("Recommendation service startup failed: %s", exc)
        raise
    finally:
        await messaging_runtime.stop()
        logger.info("Stopping recommendation-service")
