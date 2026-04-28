import uvicorn
from fastapi import FastAPI, HTTPException

from app.api.recommend_api import recommend_router
from app.core.config import settings
from app.core.lifespan import lifespan
from app.services.model_loader import model_loader

app = FastAPI(
    title="Recommendation Service",
    lifespan=lifespan,
)

app.include_router(recommend_router)


@app.get("/health")
def get_health_status():
    return {
        "status": "ok",
        "service": "recommendation-service",
    }


@app.get("/ready")
def get_readiness_status():
    readiness = model_loader.get_readiness_status()
    if not readiness["ready"]:
        raise HTTPException(
            status_code=503,
            detail=readiness,
        )

    return {
        "status": "ready",
        "service": "recommendation-service",
        "model": readiness,
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
