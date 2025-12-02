from fastapi import FastAPI
import uvicorn
from app.api.text_api import text_router
from app.api.image_api import image_router
from app.core.config import settings

app = FastAPI()

# Register routes
app.include_router(text_router, prefix="/text")
app.include_router(image_router, prefix="/image")


def start():
    """Entry point cho uvicorn"""
    print("Running on port:", settings.PORT)
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True
    )


if __name__ == "__main__":
    start()
