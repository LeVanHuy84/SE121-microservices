import uvicorn
from fastapi import FastAPI, HTTPException

from app.api.assistant_api import assistant_router
from app.core.config import settings

app = FastAPI(title="Chatbot Service")

app.include_router(assistant_router)


@app.get("/health")
def get_health_status():
    return {
        "status": "ok",
        "service": "chatbot-service",
    }


@app.get("/ready")
def get_readiness_status():
    if not settings.GROQ_API_KEY:
        raise HTTPException(
            status_code=503,
            detail={
                "status": "not_ready",
                "service": "chatbot-service",
                "provider": "groq",
                "reason": "GROQ_API_KEY is not set",
            },
        )

    return {
        "status": "ready",
        "service": "chatbot-service",
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
