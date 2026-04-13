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
            (
                "Find candidate profiles that are likely to become meaningful "
                "social connections for this viewer."
            ),
        ).strip()
        self.RECOMMENDATION_SCORE_FLOOR: float = float(
            os.getenv("RECOMMENDATION_SCORE_FLOOR", 0.55)
        )
        self.RECOMMENDATION_SCORE_CEILING: float = float(
            os.getenv("RECOMMENDATION_SCORE_CEILING", 0.9)
        )
        self.DATABASE_URL: str = os.getenv(
            "DATABASE_URL",
            "postgresql+psycopg://postgres:postgres@localhost:5432/recommendation_service",
        ).strip()
        self.RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS: int = int(
            os.getenv("RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS", 30)
        )
        self.RECOMMENDATION_PRECOMPUTE_TOP_K: int = int(
            os.getenv("RECOMMENDATION_PRECOMPUTE_TOP_K", 50)
        )
        self.RECOMMENDATION_PRECOMPUTE_BATCH_SIZE: int = int(
            os.getenv("RECOMMENDATION_PRECOMPUTE_BATCH_SIZE", 20)
        )
        self.RECOMMENDATION_PRECOMPUTED_MAX_AGE_SECONDS: int = int(
            os.getenv("RECOMMENDATION_PRECOMPUTED_MAX_AGE_SECONDS", 300)
        )
        self.RECOMMENDATION_GLOBAL_FALLBACK_TOP_K: int = int(
            os.getenv("RECOMMENDATION_GLOBAL_FALLBACK_TOP_K", 500)
        )
        self.RECOMMENDATION_GLOBAL_FALLBACK_REFRESH_INTERVAL_SECONDS: int = int(
            os.getenv("RECOMMENDATION_GLOBAL_FALLBACK_REFRESH_INTERVAL_SECONDS", 900)
        )
        self.RECOMMENDATION_QUERY_RERANK_TOP_K: int = int(
            os.getenv("RECOMMENDATION_QUERY_RERANK_TOP_K", 25)
        )
        self.RECOMMENDATION_QUERY_MODEL_WEIGHT: float = float(
            os.getenv("RECOMMENDATION_QUERY_MODEL_WEIGHT", 0.7)
        )
        self.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT: float = float(
            os.getenv("RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT", 0.3)
        )
        self.KAFKA_BROKERS: str = os.getenv("KAFKA_BROKERS", "localhost:9092").strip()
        self.KAFKA_CLIENT_ID: str = os.getenv(
            "KAFKA_CLIENT_ID", "recommendation-service"
        ).strip()
        self.KAFKA_GROUP_ID: str = os.getenv(
            "KAFKA_GROUP_ID", "recommendation-service-group"
        ).strip()
        self.KAFKA_TOPIC_INIT_RETRIES: int = int(
            os.getenv("KAFKA_TOPIC_INIT_RETRIES", 5)
        )
        self.KAFKA_TOPIC_INIT_RETRY_DELAY_SECONDS: float = float(
            os.getenv("KAFKA_TOPIC_INIT_RETRY_DELAY_SECONDS", 2)
        )
        self.KAFKA_TOPIC_INIT_WAIT_TIMEOUT_SECONDS: float = float(
            os.getenv("KAFKA_TOPIC_INIT_WAIT_TIMEOUT_SECONDS", 15)
        )
        self.RECOMMENDATION_PROFILE_TOPIC: str = os.getenv(
            "RECOMMENDATION_PROFILE_TOPIC", "recommendation-profile-events"
        ).strip()
        self.RECOMMENDATION_GRAPH_TOPIC: str = os.getenv(
            "RECOMMENDATION_GRAPH_TOPIC", "recommendation-graph-events"
        ).strip()

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

        if self.RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS <= 0:
            raise RuntimeError(
                "RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS must be positive"
            )

        if self.RECOMMENDATION_PRECOMPUTE_TOP_K <= 0:
            raise RuntimeError("RECOMMENDATION_PRECOMPUTE_TOP_K must be positive")

        if self.RECOMMENDATION_PRECOMPUTE_BATCH_SIZE <= 0:
            raise RuntimeError("RECOMMENDATION_PRECOMPUTE_BATCH_SIZE must be positive")

        if self.RECOMMENDATION_PRECOMPUTED_MAX_AGE_SECONDS <= 0:
            raise RuntimeError(
                "RECOMMENDATION_PRECOMPUTED_MAX_AGE_SECONDS must be positive"
            )

        if self.RECOMMENDATION_GLOBAL_FALLBACK_TOP_K <= 0:
            raise RuntimeError("RECOMMENDATION_GLOBAL_FALLBACK_TOP_K must be positive")

        if self.RECOMMENDATION_GLOBAL_FALLBACK_REFRESH_INTERVAL_SECONDS <= 0:
            raise RuntimeError(
                "RECOMMENDATION_GLOBAL_FALLBACK_REFRESH_INTERVAL_SECONDS must be positive"
            )

        if self.RECOMMENDATION_QUERY_RERANK_TOP_K <= 0:
            raise RuntimeError("RECOMMENDATION_QUERY_RERANK_TOP_K must be positive")

        if not self.RECOMMENDATION_QUERY_INSTRUCTION:
            raise RuntimeError("RECOMMENDATION_QUERY_INSTRUCTION must not be empty")

        if not self.DATABASE_URL:
            raise RuntimeError("DATABASE_URL must not be empty")

        if not self.KAFKA_BROKERS:
            raise RuntimeError("KAFKA_BROKERS must not be empty")

        if not self.KAFKA_CLIENT_ID:
            raise RuntimeError("KAFKA_CLIENT_ID must not be empty")

        if not self.KAFKA_GROUP_ID:
            raise RuntimeError("KAFKA_GROUP_ID must not be empty")

        if self.KAFKA_TOPIC_INIT_RETRIES <= 0:
            raise RuntimeError("KAFKA_TOPIC_INIT_RETRIES must be positive")

        if self.KAFKA_TOPIC_INIT_RETRY_DELAY_SECONDS <= 0:
            raise RuntimeError(
                "KAFKA_TOPIC_INIT_RETRY_DELAY_SECONDS must be positive"
            )

        if self.KAFKA_TOPIC_INIT_WAIT_TIMEOUT_SECONDS <= 0:
            raise RuntimeError(
                "KAFKA_TOPIC_INIT_WAIT_TIMEOUT_SECONDS must be positive"
            )

        if not self.RECOMMENDATION_PROFILE_TOPIC:
            raise RuntimeError("RECOMMENDATION_PROFILE_TOPIC must not be empty")

        if not self.RECOMMENDATION_GRAPH_TOPIC:
            raise RuntimeError("RECOMMENDATION_GRAPH_TOPIC must not be empty")

        if not (-1.0 <= self.RECOMMENDATION_SCORE_FLOOR <= 1.0):
            raise RuntimeError("RECOMMENDATION_SCORE_FLOOR must be within [-1, 1]")

        if not (-1.0 <= self.RECOMMENDATION_SCORE_CEILING <= 1.0):
            raise RuntimeError("RECOMMENDATION_SCORE_CEILING must be within [-1, 1]")

        if self.RECOMMENDATION_QUERY_MODEL_WEIGHT < 0:
            raise RuntimeError("RECOMMENDATION_QUERY_MODEL_WEIGHT must be >= 0")

        if self.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT < 0:
            raise RuntimeError("RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT must be >= 0")

        if (
            self.RECOMMENDATION_QUERY_MODEL_WEIGHT
            + self.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT
            <= 0
        ):
            raise RuntimeError(
                "RECOMMENDATION_QUERY_MODEL_WEIGHT + "
                "RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT must be > 0"
            )


settings = Settings()
