from fastapi import APIRouter
from app.services.ai.model_loader import get_model_health
import time

health_router = APIRouter()

startup_time = time.time()

@health_router.get("/health")
async def health_check():
    """
    Health check endpoint - verify service and models status.
    """
    uptime_seconds = int(time.time() - startup_time)
    
    # Get health status from model loader
    model_health = get_model_health()
    
    # All critical models loaded
    all_loaded = (
        model_health.get("initialized", False) and
        model_health.get("text_emotion", False)
    )
    
    return {
        "status": "healthy" if all_loaded else "initializing",
        "version": "3.0.0",
        "models": {
            "initialized": model_health.get("initialized", False),
            "text_emotion": "loaded" if model_health.get("text_emotion", False) else "not_loaded",
            "image_emotion": "loaded" if model_health.get("image_emotion", False) else "not_loaded",
            "text_moderation": "loaded" if model_health.get("text_moderation", False) else "not_loaded",
            "image_moderation": "loaded" if model_health.get("image_moderation", False) else "not_loaded",
        },
        "uptime_seconds": uptime_seconds,
        "ready": all_loaded
    }


@health_router.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Analysis Service",
        "version": "3.0.0",
        "status": "running"
    }
