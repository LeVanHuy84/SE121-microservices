from fastapi import FastAPI
import uvicorn
from app.api.health import health_router
from app.core.config import settings

app = FastAPI()

# Register routes
app.include_router(health_router, prefix="/health")


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
