from fastapi import FastAPI
from app.api.text_api import text_router
from app.api.image_api import image_router
from app.api.analyze_api import analyze_router
from app.core.startup import startup_tasks
import uvicorn
from app.core.config import settings
import asyncio

app = FastAPI()

# Register routes
app.include_router(text_router, prefix="/text")
app.include_router(image_router, prefix="/image")
app.include_router(analyze_router)

@app.on_event("startup")
async def startup_event():
    try:
        await startup_tasks()
    except Exception as e:
        # Log lỗi nhưng KHÔNG raise lại
        print("Startup error:", e)


def start():
    """
    Best practice:
    - Bọc uvicorn.run trong try/except để không cho tiến trình exit
    - Nếu lỗi -> giữ process sống để TurboRepo không kill toàn bộ pipeline
    """
    try:
        uvicorn.run(
            "app.main:app",
            host=settings.HOST,
            port=settings.PORT,
            reload=True
        )
    except Exception as e:
        print("Uvicorn crashed:", e)

        # Không exit tiến trình -> TurboRepo không bị kill
        # Giữ process sống vô hạn (giống NestJS dev)
        loop = asyncio.get_event_loop()
        loop.run_until_complete(_keep_alive())


async def _keep_alive():
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    start()
