from fastapi import FastAPI
from app.api.text_api import text_router
from app.api.image_api import image_router
from app.api.analyze_api import analyze_router
from app.api.health_api import health_router
from app.api.moderation_api import moderation_router
from app.core.lifespan import lifespan

app = FastAPI(
    title="Emotion Analysis Service V2.0",
    version="2.0.0",
    description="AI-powered emotion analysis with CLIP, PhoBERT, and Qwen2.5",
    lifespan=lifespan,
)

app.include_router(health_router)
app.include_router(text_router)
app.include_router(image_router)
app.include_router(analyze_router)
app.include_router(moderation_router)
