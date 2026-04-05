import uvicorn
from fastapi import FastAPI

from app.api.recommend_api import recommend_router
from app.core.config import settings
from app.core.lifespan import lifespan

app = FastAPI(
    title="Recommendation Service",
    lifespan=lifespan,
)

app.include_router(recommend_router)


def start():
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.RELOAD,
    )


if __name__ == "__main__":
    start()
