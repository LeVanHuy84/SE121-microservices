from dotenv import load_dotenv
import os

load_dotenv()

class Settings:
    PORT: int = int(os.getenv("PORT", 4010))
    HOST: str = os.getenv("HOST", "0.0.0.0")

    # Mongo
    MONGO_URL: str = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    MONGO_DB: str = os.getenv("MONGO_DB", "analysis_service")

    # Redis
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", 6379))

    # Kafka config
    KAFKA_BROKERS: str = os.getenv("KAFKA_BROKERS", "localhost:9092")
    KAFKA_CLIENT_ID: str = os.getenv("KAFKA_CLIENT_ID", "analysis_service")

    # Daily emotion aggregation
    EMOTION_PROFILE_EMA_ALPHA: float = float(os.getenv("EMOTION_PROFILE_EMA_ALPHA", 0.2))
    EMOTION_DAILY_CRON_HOUR_UTC: int = int(os.getenv("EMOTION_DAILY_CRON_HOUR_UTC", 0))
    EMOTION_DAILY_CRON_MINUTE_UTC: int = int(os.getenv("EMOTION_DAILY_CRON_MINUTE_UTC", 5))

    INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY")
    if not INTERNAL_SERVICE_KEY:
        raise RuntimeError("INTERNAL_SERVICE_KEY is not set")
    
    EMOTION_MODEL_VERSION = os.getenv("EMOTION_MODEL_VERSION", "1.0.0")
    MODERATION_MODEL_VERSION = os.getenv("MODERATION_MODEL_VERSION", "1.0.0")


settings = Settings()
