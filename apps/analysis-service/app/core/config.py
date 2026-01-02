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

    INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY")
    if not INTERNAL_SERVICE_KEY:
        raise RuntimeError("INTERNAL_SERVICE_KEY is not set")


settings = Settings()
