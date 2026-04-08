import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    def __init__(self):
        self.PORT: int = int(os.getenv("PORT", 4011))
        self.HOST: str = os.getenv("HOST", "0.0.0.0")
        self.RELOAD: bool = os.getenv("RELOAD", "false").lower() == "true"

        self.INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "").strip()
        self.RECOMMENDATION_MODEL_NAME: str = os.getenv(
            "RECOMMENDATION_MODEL_NAME",
            "intfloat/multilingual-e5-base",
        ).strip()
        self.RECOMMENDATION_MAX_LENGTH: int = int(
            os.getenv("RECOMMENDATION_MAX_LENGTH", 256)
        )
        self.RECOMMENDATION_BATCH_SIZE: int = int(
            os.getenv("RECOMMENDATION_BATCH_SIZE", 16)
        )
        self.RECOMMENDATION_MAX_CANDIDATES: int = int(
            os.getenv("RECOMMENDATION_MAX_CANDIDATES", 100)
        )
        self.RECOMMENDATION_QUERY_INSTRUCTION: str = os.getenv(
            "RECOMMENDATION_QUERY_INSTRUCTION",
            "Find candidate profiles that are likely to become meaningful social connections for this viewer.",
        ).strip()
        self.RECOMMENDATION_SCORE_FLOOR: float = float(
            os.getenv("RECOMMENDATION_SCORE_FLOOR", 0.55)
        )
        self.RECOMMENDATION_SCORE_CEILING: float = float(
            os.getenv("RECOMMENDATION_SCORE_CEILING", 0.9)
        )

        self._validate()

    def _validate(self):
        if not self.INTERNAL_SERVICE_KEY:
            raise RuntimeError("INTERNAL_SERVICE_KEY is not set")

        if not self.RECOMMENDATION_MODEL_NAME:
            raise RuntimeError("RECOMMENDATION_MODEL_NAME must not be empty")

        if not (1 <= self.PORT <= 65535):
            raise RuntimeError("PORT must be between 1 and 65535")

        if self.RECOMMENDATION_MAX_LENGTH <= 0:
            raise RuntimeError("RECOMMENDATION_MAX_LENGTH must be positive")

        if self.RECOMMENDATION_BATCH_SIZE <= 0:
            raise RuntimeError("RECOMMENDATION_BATCH_SIZE must be positive")

        if self.RECOMMENDATION_MAX_CANDIDATES <= 0:
            raise RuntimeError("RECOMMENDATION_MAX_CANDIDATES must be positive")

        if not self.RECOMMENDATION_QUERY_INSTRUCTION:
            raise RuntimeError("RECOMMENDATION_QUERY_INSTRUCTION must not be empty")

        if not (-1.0 <= self.RECOMMENDATION_SCORE_FLOOR <= 1.0):
            raise RuntimeError("RECOMMENDATION_SCORE_FLOOR must be within [-1, 1]")

        if not (-1.0 <= self.RECOMMENDATION_SCORE_CEILING <= 1.0):
            raise RuntimeError("RECOMMENDATION_SCORE_CEILING must be within [-1, 1]")


settings = Settings()
