from dotenv import load_dotenv
import os

load_dotenv()


class Settings:
    PORT: int = int(os.getenv("PORT", 4011))
    HOST: str = os.getenv("HOST", "0.0.0.0")

    INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY")
    if not INTERNAL_SERVICE_KEY:
        raise RuntimeError("INTERNAL_SERVICE_KEY is not set")

    RECOMMENDATION_MODEL_NAME: str = os.getenv(
        "RECOMMENDATION_MODEL_NAME",
        "cross-encoder/ms-marco-MiniLM-L-6-v2",
    )
    RECOMMENDATION_MAX_LENGTH: int = int(
        os.getenv("RECOMMENDATION_MAX_LENGTH", 256)
    )
    RECOMMENDATION_BATCH_SIZE: int = int(
        os.getenv("RECOMMENDATION_BATCH_SIZE", 16)
    )


settings = Settings()
