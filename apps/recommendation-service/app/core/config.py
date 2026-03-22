from dotenv import load_dotenv
import os

load_dotenv()


class Settings:
    PORT: int = int(os.getenv("PORT", 4011))
    HOST: str = os.getenv("HOST", "0.0.0.0")
    RELOAD: bool = os.getenv("RELOAD", "false").lower() == "true"

    INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY")
    if not INTERNAL_SERVICE_KEY:
        raise RuntimeError("INTERNAL_SERVICE_KEY is not set")

    RECOMMENDATION_MODEL_NAME: str = os.getenv(
        "RECOMMENDATION_MODEL_NAME",
        "intfloat/multilingual-e5-base",
    )
    RECOMMENDATION_MAX_LENGTH: int = int(
        os.getenv("RECOMMENDATION_MAX_LENGTH", 256)
    )
    RECOMMENDATION_BATCH_SIZE: int = int(
        os.getenv("RECOMMENDATION_BATCH_SIZE", 16)
    )
    RECOMMENDATION_MAX_CANDIDATES: int = int(
        os.getenv("RECOMMENDATION_MAX_CANDIDATES", 100)
    )
    RECOMMENDATION_QUERY_INSTRUCTION: str = os.getenv(
        "RECOMMENDATION_QUERY_INSTRUCTION",
        "Find candidate profiles that are likely to become meaningful social connections for this viewer.",
    )
    RECOMMENDATION_SCORE_FLOOR: float = float(
        os.getenv("RECOMMENDATION_SCORE_FLOOR", 0.55)
    )
    RECOMMENDATION_SCORE_CEILING: float = float(
        os.getenv("RECOMMENDATION_SCORE_CEILING", 0.9)
    )


settings = Settings()
