import uvicorn
from fastapi import FastAPI, HTTPException

from app.core.lifespan import lifespan
from app.core.otel import init_otel
from app.core.settings import settings
from app.modules.analysis.router import health_router, music_router, test_router
from app.modules.chatbot.router import assistant_router


app = FastAPI(title="AI Chatbot Service")
init_otel(app, "ai-chatbot-service")

# Reconfigure the app lifespan after importing it
app.router.lifespan_context = lifespan

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
    if not settings.GROQ_API_KEY:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "not_ready",
                "service": "ai-chatbot-service",
                "provider": "groq",
                "reason": "GROQ_API_KEY is not set",
            },
        )

    return {
        "status": "ready",
        "service": "ai-chatbot-service",
        "provider": "groq",
        "model": settings.GROQ_MODEL,
    }


def start():
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.RELOAD,
    )


if __name__ == "__main__":
    start()