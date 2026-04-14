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
        self.ASSISTANT_DOCS_DIR: str = os.getenv(
            "ASSISTANT_DOCS_DIR", "docs/assistant"
        ).strip()

        self.EMBEDDING_MODEL_NAME: str = os.getenv(
            "EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base"
        ).strip()
        self.EMBEDDING_MAX_LENGTH: int = int(os.getenv("EMBEDDING_MAX_LENGTH", 512))
        self.EMBEDDING_BATCH_SIZE: int = int(os.getenv("EMBEDDING_BATCH_SIZE", 8))
        self.RAG_INDEX_NAME: str = os.getenv(
            "RAG_INDEX_NAME", "assistant_rag_documents"
        ).strip()
        self.RAG_DOCS_ENABLED: bool = (
            os.getenv("RAG_DOCS_ENABLED", "true").lower() == "true"
        )
        self.RAG_CHUNK_SIZE: int = int(os.getenv("RAG_CHUNK_SIZE", 900))
        self.RAG_CHUNK_OVERLAP: int = int(os.getenv("RAG_CHUNK_OVERLAP", 120))
        self.RAG_DOC_TOP_K: int = int(os.getenv("RAG_DOC_TOP_K", 5))
        self.RAG_WARMUP_ON_STARTUP: bool = (
            os.getenv("RAG_WARMUP_ON_STARTUP", "true").lower() == "true"
        )
        self.ES_NODE: str = os.getenv("ES_NODE", "http://localhost:9200").strip()

        self.GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "").strip()
        self.GROQ_MODEL: str = os.getenv(
            "GROQ_MODEL", "llama-3.3-70b-versatile"
        ).strip()
        os.environ.pop("GROQ_BASE_URL", None)
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

        if not self.ASSISTANT_DOCS_DIR:
            raise RuntimeError("ASSISTANT_DOCS_DIR must not be empty")

        if not self.EMBEDDING_MODEL_NAME:
            raise RuntimeError("EMBEDDING_MODEL_NAME must not be empty")

        if self.EMBEDDING_MAX_LENGTH <= 0:
            raise RuntimeError("EMBEDDING_MAX_LENGTH must be positive")

        if self.EMBEDDING_BATCH_SIZE <= 0:
            raise RuntimeError("EMBEDDING_BATCH_SIZE must be positive")

        if not self.RAG_INDEX_NAME:
            raise RuntimeError("RAG_INDEX_NAME must not be empty")

        if self.RAG_CHUNK_SIZE <= 0:
            raise RuntimeError("RAG_CHUNK_SIZE must be positive")

        if self.RAG_CHUNK_OVERLAP < 0:
            raise RuntimeError("RAG_CHUNK_OVERLAP must be >= 0")

        if self.RAG_CHUNK_OVERLAP >= self.RAG_CHUNK_SIZE:
            raise RuntimeError("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE")

        if self.RAG_DOC_TOP_K <= 0:
            raise RuntimeError("RAG_DOC_TOP_K must be positive")

        if not self.ES_NODE:
            raise RuntimeError("ES_NODE must not be empty")

        if not self.GROQ_MODEL:
            raise RuntimeError("GROQ_MODEL must not be empty")

        if self.GROQ_TIMEOUT_SECONDS <= 0:
            raise RuntimeError("GROQ_TIMEOUT_SECONDS must be positive")

        if self.GROQ_MAX_TOKENS <= 0:
            raise RuntimeError("GROQ_MAX_TOKENS must be positive")

        if not (0 <= self.GROQ_TEMPERATURE <= 2):
            raise RuntimeError("GROQ_TEMPERATURE must be between 0 and 2")


settings = Settings()
