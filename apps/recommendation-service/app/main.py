import asyncio
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
    try:
        uvicorn.run(
            "app.main:app",
            host=settings.HOST,
            port=settings.PORT,
            reload=True,
        )
    except Exception as exc:
        print("Uvicorn crashed:", exc)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(_keep_alive())


async def _keep_alive():
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    start()
