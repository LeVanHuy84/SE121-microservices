import uvicorn
import asyncio
from fastapi import FastAPI

from app.api.text_api import text_router
from app.api.image_api import image_router
from app.api.analyze_api import analyze_router
from app.core.lifespan import lifespan
from app.core.config import settings

app = FastAPI(
    title="Emotion Service",
    lifespan=lifespan,
)

app.include_router(text_router, prefix="/text")
app.include_router(image_router, prefix="/image")
app.include_router(analyze_router)


def start():
    try:
        uvicorn.run(
            "app.main:app",
            host=settings.HOST,
            port=settings.PORT,
            reload=True,
        )
    except Exception as e:
        print("Uvicorn crashed:", e)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(_keep_alive())


async def _keep_alive():
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    start()
