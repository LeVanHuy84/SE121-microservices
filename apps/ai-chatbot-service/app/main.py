import json
import logging
from datetime import datetime, timezone
import uvicorn
from fastapi import FastAPI, HTTPException

from app.core.lifespan import lifespan
from app.core.otel import init_otel
from app.core.settings import settings
from app.modules.analysis.router import health_router, music_router, test_router
from app.modules.chatbot.router import assistant_router
from app.modules.chatbot.public_router import (
    public_router,
    register_public_error_handlers,
)
from fastapi.responses import Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "service": "ai-chatbot-service",
            "context": record.name,
            "message": record.getMessage(),
        }
        try:
            from opentelemetry import trace

            span = trace.get_current_span()
            span_ctx = span.get_span_context() if span else None
            if span_ctx and span_ctx.is_valid:
                payload["traceId"] = format(span_ctx.trace_id, "032x")
                payload["spanId"] = format(span_ctx.span_id, "016x")
        except Exception:
            pass
        if record.exc_info:
            payload["stack"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


# Configure structured JSON logging
log_level = getattr(logging, settings.LOG_LEVEL, logging.INFO)
_root_handler = logging.StreamHandler()
_root_handler.setFormatter(JsonLogFormatter())
logging.basicConfig(
    level=log_level,
    handlers=[_root_handler],
    force=True,
)

if settings.IS_SILENT:
    for noisy in [
        "uvicorn.access",
        "uvicorn.error",
        "aiokafka",
        "kafka",
        "elasticsearch",
        "httpx",
        "httpcore",
    ]:
        logging.getLogger(noisy).setLevel(logging.WARNING)

app = FastAPI(title="AI Chatbot Service")
init_otel(app, "ai-chatbot-service")

# Reconfigure the app lifespan after importing it
app.router.lifespan_context = lifespan

register_public_error_handlers(app)
app.include_router(public_router)
# Legacy router (/assistant/*): kept temporarily for internal compatibility; not used by the FE.
app.include_router(assistant_router)
app.include_router(health_router)
app.include_router(music_router)
app.include_router(test_router)


@app.get("/health")
def get_health_status():
    return {
        "status": "ok",
        "service": "ai-chatbot-service",
    }


@app.get("/ready")
def get_readiness_status():
    if not settings.CHATBOT_LLM_STUB_MODE and not settings.GROQ_API_KEY:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "not_ready",
                "service": "ai-chatbot-service",
                "provider": "groq",
                "reason": "GROQ_API_KEY is not set",
            },
        )

    from app.modules.chatbot.navigation.catalog import destination_catalog

    destinations_count = len(destination_catalog)
    if destinations_count == 0:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "not_ready",
                "service": "ai-chatbot-service",
                "reason": "Navigation destination catalog is empty",
            },
        )

    return {
        "status": "ready",
        "service": "ai-chatbot-service",
        "provider": "stub" if settings.CHATBOT_LLM_STUB_MODE else "groq",
        "model": "stub-deterministic"
        if settings.CHATBOT_LLM_STUB_MODE
        else settings.GROQ_MODEL,
        "navigator": {
            "status": "ready",
            "destinations_count": destinations_count,
        },
    }


@app.get("/metrics")
def get_metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


def start():
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.RELOAD,
        log_level=settings.LOG_LEVEL.lower(),
        access_log=not settings.IS_SILENT,
    )


if __name__ == "__main__":
    start()
