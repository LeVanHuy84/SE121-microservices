import os

from dotenv import load_dotenv

load_dotenv()


class Settings:
    def __init__(self):
        self.PORT: int = int(os.getenv("PORT", 4013))
        self.HOST: str = os.getenv("HOST", "0.0.0.0").strip()
        self.RELOAD: bool = os.getenv("RELOAD", "false").lower() == "true"
        self.INTERNAL_SERVICE_KEY: str = os.getenv(
            "INTERNAL_SERVICE_KEY", ""
        ).strip()

        self.CHATBOT_MODEL: str = os.getenv("CHATBOT_MODEL", "qwen3:4b").strip()
        self.CHATBOT_MAX_HISTORY_ITEMS: int = int(
            os.getenv("CHATBOT_MAX_HISTORY_ITEMS", 10)
        )
        self.CHATBOT_MAX_CONTEXT_ITEMS: int = int(
            os.getenv("CHATBOT_MAX_CONTEXT_ITEMS", 8)
        )
        self.CHATBOT_CONTEXT_CHAR_LIMIT: int = int(
            os.getenv("CHATBOT_CONTEXT_CHAR_LIMIT", 1200)
        )
        self.CHATBOT_SESSION_TTL_SECONDS: int = int(
            os.getenv("CHATBOT_SESSION_TTL_SECONDS", 3600)
        )

        self.OLLAMA_BASE_URL: str = os.getenv(
            "OLLAMA_BASE_URL", "http://localhost:11434"
        ).rstrip("/")
        self.OLLAMA_TIMEOUT_SECONDS: float = float(
            os.getenv("OLLAMA_TIMEOUT_SECONDS", 45)
        )

        self._validate()

    def _validate(self):
        if not (1 <= self.PORT <= 65535):
            raise RuntimeError("PORT must be between 1 and 65535")

        if not self.HOST:
            raise RuntimeError("HOST must not be empty")

        if not self.INTERNAL_SERVICE_KEY:
            raise RuntimeError("INTERNAL_SERVICE_KEY is not set")

        if not self.CHATBOT_MODEL:
            raise RuntimeError("CHATBOT_MODEL must not be empty")

        if self.CHATBOT_MAX_HISTORY_ITEMS <= 0:
            raise RuntimeError("CHATBOT_MAX_HISTORY_ITEMS must be positive")

        if self.CHATBOT_MAX_CONTEXT_ITEMS < 0:
            raise RuntimeError("CHATBOT_MAX_CONTEXT_ITEMS must be >= 0")

        if self.CHATBOT_CONTEXT_CHAR_LIMIT <= 0:
            raise RuntimeError("CHATBOT_CONTEXT_CHAR_LIMIT must be positive")

        if self.CHATBOT_SESSION_TTL_SECONDS <= 0:
            raise RuntimeError("CHATBOT_SESSION_TTL_SECONDS must be positive")

        if self.OLLAMA_TIMEOUT_SECONDS <= 0:
            raise RuntimeError("OLLAMA_TIMEOUT_SECONDS must be positive")

        if not self.OLLAMA_BASE_URL:
            raise RuntimeError("OLLAMA_BASE_URL must not be empty")


settings = Settings()
