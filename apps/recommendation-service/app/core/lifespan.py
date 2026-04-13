import asyncio
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)


async def warmup_model_in_background(model_loader):
    try:
        await asyncio.get_running_loop().run_in_executor(None, model_loader.warmup)
        logger.info("Recommendation model warmed up")
    except Exception as exc:
        logger.exception("Recommendation model warmup failed: %s", exc)


@asynccontextmanager
async def lifespan(app):
    from app.bootstrap import messaging_runtime, state_repository
    from app.services.model_loader import model_loader

    warmup_task = None

    try:
        logger.info("Starting recommendation-service")

        state_repository.validate_connection()
        state_repository.validate_schema()
        logger.info("Recommendation state repository connected and schema validated")
        await messaging_runtime.start()
        logger.info("Recommendation messaging and processor started")
        warmup_task = asyncio.create_task(warmup_model_in_background(model_loader))
        yield
    except Exception as exc:
        logger.exception("Recommendation service startup failed: %s", exc)
        raise
    finally:
        if warmup_task:
            warmup_task.cancel()
            await asyncio.gather(warmup_task, return_exceptions=True)
        await messaging_runtime.stop()
        logger.info("Stopping recommendation-service")
