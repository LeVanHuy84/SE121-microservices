import asyncio
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app):
    try:
        logger.info("Starting recommendation-service")
        from app.services.model_loader import model_loader
        from app.messaging.runtime import messaging_runtime

        await asyncio.get_running_loop().run_in_executor(None, model_loader.warmup)
        logger.info("Recommendation model warmed up")
        await messaging_runtime.start()
        yield
    except Exception as exc:
        logger.exception("Recommendation service startup failed: %s", exc)
        raise
    finally:
        from app.messaging.runtime import messaging_runtime

        await messaging_runtime.stop()
        logger.info("Stopping recommendation-service")
