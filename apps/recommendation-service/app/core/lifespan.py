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


async def warmup_query_cache_in_background(
    recommendation_query_service,
    viewer_ids: list[str],
    query_limit: int,
):
    if not viewer_ids:
        return

    from app.models.rerank_request import RecommendationQueryRequest

    logger.info(
        "Recommendation cache warmup started: viewers=%s limit=%s",
        len(viewer_ids),
        query_limit,
    )
    for viewer_id in viewer_ids:
        try:
            await asyncio.to_thread(
                recommendation_query_service.query,
                RecommendationQueryRequest(
                    viewerId=viewer_id,
                    limit=query_limit,
                    cursor=None,
                ),
            )
        except Exception as exc:
            logger.warning(
                "Recommendation cache warmup failed for viewerId=%s: %s",
                viewer_id,
                exc,
            )
    logger.info("Recommendation cache warmup completed")


@asynccontextmanager
async def lifespan(app):
    from app.bootstrap import messaging_runtime, state_repository
    from app.core.config import settings
    from app.services.model_loader import model_loader
    from app.bootstrap import recommendation_query_service

    warmup_task = None
    messaging_started = False

    try:
        logger.info("Starting recommendation-service")

        state_repository.validate_connection()
        state_repository.validate_schema()
        logger.info("Recommendation state repository connected and schema validated")
        try:
            await messaging_runtime.start()
            messaging_started = True
            logger.info("Recommendation messaging and processor started")
        except Exception as exc:
            if settings.KAFKA_REQUIRED:
                raise
            logger.warning(
                "Kafka unavailable at startup; recommendation API will run without messaging runtime: %s",
                exc,
            )
        warmup_task = asyncio.create_task(warmup_model_in_background(model_loader))
        warmup_viewer_ids = [
            viewer_id.strip()
            for viewer_id in settings.RECOMMENDATION_WARMUP_VIEWER_IDS.split(",")
            if viewer_id.strip()
        ]
        warmup_limit = max(1, int(settings.RECOMMENDATION_WARMUP_QUERY_LIMIT))
        if warmup_viewer_ids:
            asyncio.create_task(
                warmup_query_cache_in_background(
                    recommendation_query_service,
                    warmup_viewer_ids,
                    warmup_limit,
                )
            )
        yield
    except Exception as exc:
        logger.exception("Recommendation service startup failed: %s", exc)
        raise
    finally:
        if warmup_task:
            warmup_task.cancel()
            await asyncio.gather(warmup_task, return_exceptions=True)
        if messaging_started:
            await messaging_runtime.stop()
        logger.info("Stopping recommendation-service")
