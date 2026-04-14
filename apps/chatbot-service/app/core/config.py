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

        self.GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "").strip()
        self.GROQ_MODEL: str = os.getenv(
            "GROQ_MODEL", "llama-3.3-70b-versatile"
        ).strip()
        self.GROQ_BASE_URL: str = os.getenv(
            "GROQ_BASE_URL", "https://api.groq.com/openai/v1"
        ).rstrip("/")
        self.GROQ_TIMEOUT_SECONDS: float = float(
            os.getenv("GROQ_TIMEOUT_SECONDS", 45)
        )
        self.GROQ_MAX_TOKENS: int = int(os.getenv("GROQ_MAX_TOKENS", 1024))
        self.GROQ_TEMPERATURE: float = float(
            os.getenv("GROQ_TEMPERATURE", 0.2)
        )

        self._validate()

    def _validate(self):
        if not (1 <= self.PORT <= 65535):
            raise RuntimeError("PORT must be between 1 and 65535")

        if not self.HOST:
            raise RuntimeError("HOST must not be empty")

        if not self.INTERNAL_SERVICE_KEY:
            raise RuntimeError("INTERNAL_SERVICE_KEY is not set")

        if self.CHATBOT_MAX_HISTORY_ITEMS <= 0:
            raise RuntimeError("CHATBOT_MAX_HISTORY_ITEMS must be positive")

        if self.CHATBOT_MAX_CONTEXT_ITEMS < 0:
            raise RuntimeError("CHATBOT_MAX_CONTEXT_ITEMS must be >= 0")

        if self.CHATBOT_CONTEXT_CHAR_LIMIT <= 0:
            raise RuntimeError("CHATBOT_CONTEXT_CHAR_LIMIT must be positive")

        if self.CHATBOT_SESSION_TTL_SECONDS <= 0:
            raise RuntimeError("CHATBOT_SESSION_TTL_SECONDS must be positive")

        if not self.GROQ_MODEL:
            raise RuntimeError("GROQ_MODEL must not be empty")

        if not self.GROQ_BASE_URL:
            raise RuntimeError("GROQ_BASE_URL must not be empty")

        if self.GROQ_TIMEOUT_SECONDS <= 0:
            raise RuntimeError("GROQ_TIMEOUT_SECONDS must be positive")

        if self.GROQ_MAX_TOKENS <= 0:
            raise RuntimeError("GROQ_MAX_TOKENS must be positive")

        if not (0 <= self.GROQ_TEMPERATURE <= 2):
            raise RuntimeError("GROQ_TEMPERATURE must be between 0 and 2")


settings = Settings()
