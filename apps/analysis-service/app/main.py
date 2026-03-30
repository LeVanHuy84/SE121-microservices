from fastapi import FastAPI
from app.api.test_api import test_router
from app.api.image_api import image_router
from app.api.analyze_api import analyze_router
from app.api.health_api import health_router
from app.api.moderation_api import moderation_router
from app.api.emotion_feature_api import emotion_feature_router
from app.core.lifespan import lifespan

app = FastAPI(
    title="Emotion Analysis Service V2.0",
    version="2.0.0",
    description="AI-powered emotion analysis with FER, CLIP, PhoBERT",
    lifespan=lifespan,
)

app.include_router(health_router)
# app.include_router(test_router)
# app.include_router(image_router)
app.include_router(analyze_router)
# app.include_router(moderation_router)
app.include_router(emotion_feature_router)
