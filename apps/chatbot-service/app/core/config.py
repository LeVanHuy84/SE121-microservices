import os
from math import isfinite

from dotenv import load_dotenv

load_dotenv()


class Settings:
    def __init__(self):
        self.PORT: int = int(os.getenv("PORT", 4015))
        self.HOST: str = os.getenv("HOST", "0.0.0.0").strip()
        self.RELOAD: bool = os.getenv("RELOAD", "false").lower() == "true"
        self.INTERNAL_SERVICE_KEY: str = os.getenv(
            "INTERNAL_SERVICE_KEY", ""
        ).strip()

        self.CHATBOT_MEMORY_RECENT_TURNS: int = int(
            os.getenv("CHATBOT_MEMORY_RECENT_TURNS", 8)
        )
        self.CHATBOT_MEMORY_STORED_TURNS: int = int(
            os.getenv("CHATBOT_MEMORY_STORED_TURNS", 16)
        )
        self.CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT: int = int(
            os.getenv("CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT", 2500)
        )
        self.CHATBOT_MEMORY_RECENT_ITEMS: int = self.CHATBOT_MEMORY_RECENT_TURNS * 2
        self.CHATBOT_MEMORY_STORED_ITEMS: int = self.CHATBOT_MEMORY_STORED_TURNS * 2
        self.CHATBOT_MAX_CONTEXT_ITEMS: int = int(
            os.getenv("CHATBOT_MAX_CONTEXT_ITEMS", 8)
        )
        self.CHATBOT_CONTEXT_CHAR_LIMIT: int = int(
            os.getenv("CHATBOT_CONTEXT_CHAR_LIMIT", 1200)
        )
        self.CHATBOT_CONTEXT_CANDIDATE_POOL_SIZE: int = int(
            os.getenv(
                "CHATBOT_CONTEXT_CANDIDATE_POOL_SIZE",
                max(self.CHATBOT_MAX_CONTEXT_ITEMS * 2, self.CHATBOT_MAX_CONTEXT_ITEMS),
            )
        )
        self.CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS: int = int(
            os.getenv("CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS", 500)
        )
        self.CHATBOT_METRICS_ENABLED: bool = (
            os.getenv("CHATBOT_METRICS_ENABLED", "true").lower() == "true"
        )
        self.CHATBOT_METRICS_WINDOW_SIZE: int = int(
            os.getenv("CHATBOT_METRICS_WINDOW_SIZE", 200)
        )
        self.CHATBOT_METRICS_LOG_EVERY_N: int = int(
            os.getenv("CHATBOT_METRICS_LOG_EVERY_N", 50)
        )
        self.CHATBOT_PROMPT_HISTORY_ITEMS_MAX: int = int(
            os.getenv("CHATBOT_PROMPT_HISTORY_ITEMS_MAX", 4)
        )
        self.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT: int = int(
            os.getenv("CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT", 280)
        )
        self.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT: int = int(
            os.getenv("CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT", 2200)
        )
        self.CHATBOT_PROMPT_AB_TEST_ENABLED: bool = (
            os.getenv("CHATBOT_PROMPT_AB_TEST_ENABLED", "false").lower() == "true"
        )
        self.CHATBOT_PROMPT_AB_BUCKET_RATIO: float = float(
            os.getenv("CHATBOT_PROMPT_AB_BUCKET_RATIO", 0.5)
        )
        self.CHATBOT_MAX_CONTEXT_ITEMS_A: int = int(
            os.getenv("CHATBOT_MAX_CONTEXT_ITEMS_A", self.CHATBOT_MAX_CONTEXT_ITEMS)
        )
        self.CHATBOT_MAX_CONTEXT_ITEMS_B: int = int(
            os.getenv("CHATBOT_MAX_CONTEXT_ITEMS_B", 6)
        )
        self.CHATBOT_CONTEXT_CHAR_LIMIT_A: int = int(
            os.getenv("CHATBOT_CONTEXT_CHAR_LIMIT_A", self.CHATBOT_CONTEXT_CHAR_LIMIT)
        )
        self.CHATBOT_CONTEXT_CHAR_LIMIT_B: int = int(
            os.getenv("CHATBOT_CONTEXT_CHAR_LIMIT_B", 900)
        )
        self.CHATBOT_PROMPT_HISTORY_ITEMS_MAX_A: int = int(
            os.getenv(
                "CHATBOT_PROMPT_HISTORY_ITEMS_MAX_A",
                self.CHATBOT_PROMPT_HISTORY_ITEMS_MAX,
            )
        )
        self.CHATBOT_PROMPT_HISTORY_ITEMS_MAX_B: int = int(
            os.getenv("CHATBOT_PROMPT_HISTORY_ITEMS_MAX_B", 3)
        )
        self.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_A: int = int(
            os.getenv(
                "CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_A",
                self.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT,
            )
        )
        self.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_B: int = int(
            os.getenv("CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_B", 220)
        )
        self.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_A: int = int(
            os.getenv(
                "CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_A",
                self.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT,
            )
        )
        self.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_B: int = int(
            os.getenv("CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_B", 1600)
        )
        self.CHATBOT_SESSION_TTL_SECONDS: int = int(
            os.getenv("CHATBOT_SESSION_TTL_SECONDS", 3600)
        )
        self.CHATBOT_REDIS_URL: str = os.getenv(
            "CHATBOT_REDIS_URL", "redis://localhost:6379/0"
        ).strip()
        self.CHATBOT_REDIS_CONNECT_TIMEOUT_SECONDS: float = float(
            os.getenv("CHATBOT_REDIS_CONNECT_TIMEOUT_SECONDS", 0.5)
        )
        self.CHATBOT_REDIS_SOCKET_TIMEOUT_SECONDS: float = float(
            os.getenv("CHATBOT_REDIS_SOCKET_TIMEOUT_SECONDS", 0.5)
        )
        self.CHATBOT_REDIS_RECONNECT_BACKOFF_SECONDS: float = float(
            os.getenv("CHATBOT_REDIS_RECONNECT_BACKOFF_SECONDS", 5)
        )
        self.CHATBOT_MEMORY_KEY_PREFIX: str = os.getenv(
            "CHATBOT_MEMORY_KEY_PREFIX", "chatbot:assistant"
        ).strip()
        self.DATABASE_URL: str = os.getenv("DATABASE_URL", "").strip()
        self.CHATBOT_DB_ENABLED: bool = (
            os.getenv("CHATBOT_DB_ENABLED", "false").lower() == "true"
        )
        self.CHATBOT_DB_ECHO: bool = (
            os.getenv("CHATBOT_DB_ECHO", "false").lower() == "true"
        )
        self.CHATBOT_DB_POOL_SIZE: int = int(
            os.getenv("CHATBOT_DB_POOL_SIZE", 10)
        )
        self.CHATBOT_DB_MAX_OVERFLOW: int = int(
            os.getenv("CHATBOT_DB_MAX_OVERFLOW", 20)
        )
        self.CHATBOT_DB_POOL_TIMEOUT_SECONDS: float = float(
            os.getenv("CHATBOT_DB_POOL_TIMEOUT_SECONDS", 5)
        )
        self.CHATBOT_DB_POOL_RECYCLE_SECONDS: int = int(
            os.getenv("CHATBOT_DB_POOL_RECYCLE_SECONDS", 1800)
        )
        self.CHATBOT_DB_COMMAND_TIMEOUT_SECONDS: float = float(
            os.getenv("CHATBOT_DB_COMMAND_TIMEOUT_SECONDS", 8)
        )
        self.CHATBOT_HISTORY_PAGE_SIZE_DEFAULT: int = int(
            os.getenv("CHATBOT_HISTORY_PAGE_SIZE_DEFAULT", 20)
        )
        self.CHATBOT_HISTORY_PAGE_SIZE_MAX: int = int(
            os.getenv("CHATBOT_HISTORY_PAGE_SIZE_MAX", 100)
        )
        self.CHATBOT_HISTORY_PERSIST_TIMEOUT_MS: int = int(
            os.getenv("CHATBOT_HISTORY_PERSIST_TIMEOUT_MS", 5000)
        )
        self.ASSISTANT_DOCS_DIR: str = os.getenv(
            "ASSISTANT_DOCS_DIR", "docs/assistant"
        ).strip()

        self.EMBEDDING_MODEL_NAME: str = os.getenv(
            "EMBEDDING_MODEL_NAME", "intfloat/multilingual-e5-base"
        ).strip()
        self.EMBEDDING_MAX_LENGTH: int = int(os.getenv("EMBEDDING_MAX_LENGTH", 512))
        self.EMBEDDING_BATCH_SIZE: int = int(os.getenv("EMBEDDING_BATCH_SIZE", 8))
        self.EMBEDDING_QUERY_CACHE_SIZE: int = int(
            os.getenv("EMBEDDING_QUERY_CACHE_SIZE", 256)
        )
        self.RAG_INDEX_NAME: str = os.getenv(
            "RAG_INDEX_NAME", "assistant_rag_documents"
        ).strip()
        self.RAG_DOCS_ENABLED: bool = (
            os.getenv("RAG_DOCS_ENABLED", "true").lower() == "true"
        )
        self.RAG_CHUNK_SIZE: int = int(os.getenv("RAG_CHUNK_SIZE", 900))
        self.RAG_CHUNK_OVERLAP: int = int(os.getenv("RAG_CHUNK_OVERLAP", 120))
        self.RAG_DOC_TOP_K: int = int(os.getenv("RAG_DOC_TOP_K", 5))
        self.RAG_DOC_MAX_CHUNKS_PER_DOC: int = int(
            os.getenv("RAG_DOC_MAX_CHUNKS_PER_DOC", 2)
        )
        self.RAG_DOC_SEARCH_VISIBILITY: str = os.getenv(
            "RAG_DOC_SEARCH_VISIBILITY", "public"
        ).strip()
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
        self.CHATBOT_LLM_TIMEOUT_MS: int = int(
            os.getenv("CHATBOT_LLM_TIMEOUT_MS", 12000)
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

        if self.CHATBOT_MEMORY_RECENT_TURNS <= 0:
            raise RuntimeError("CHATBOT_MEMORY_RECENT_TURNS must be positive")

        if self.CHATBOT_MEMORY_STORED_TURNS <= 0:
            raise RuntimeError("CHATBOT_MEMORY_STORED_TURNS must be positive")

        if self.CHATBOT_MEMORY_STORED_TURNS < self.CHATBOT_MEMORY_RECENT_TURNS:
            raise RuntimeError(
                "CHATBOT_MEMORY_STORED_TURNS must be >= CHATBOT_MEMORY_RECENT_TURNS"
            )

        if self.CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT <= 0:
            raise RuntimeError("CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT must be positive")

        if self.CHATBOT_MAX_CONTEXT_ITEMS < 0:
            raise RuntimeError("CHATBOT_MAX_CONTEXT_ITEMS must be >= 0")

        if self.CHATBOT_CONTEXT_CHAR_LIMIT <= 0:
            raise RuntimeError("CHATBOT_CONTEXT_CHAR_LIMIT must be positive")

        if self.CHATBOT_CONTEXT_CANDIDATE_POOL_SIZE <= 0:
            raise RuntimeError("CHATBOT_CONTEXT_CANDIDATE_POOL_SIZE must be positive")

        if self.CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS <= 0:
            raise RuntimeError("CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS must be positive")

        if self.CHATBOT_METRICS_WINDOW_SIZE <= 0:
            raise RuntimeError("CHATBOT_METRICS_WINDOW_SIZE must be positive")

        if self.CHATBOT_METRICS_LOG_EVERY_N <= 0:
            raise RuntimeError("CHATBOT_METRICS_LOG_EVERY_N must be positive")

        if self.CHATBOT_PROMPT_HISTORY_ITEMS_MAX <= 0:
            raise RuntimeError("CHATBOT_PROMPT_HISTORY_ITEMS_MAX must be positive")

        if self.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT <= 0:
            raise RuntimeError("CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT must be positive")

        if self.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT <= 0:
            raise RuntimeError("CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT must be positive")

        if not isfinite(self.CHATBOT_PROMPT_AB_BUCKET_RATIO):
            raise RuntimeError("CHATBOT_PROMPT_AB_BUCKET_RATIO must be finite")

        if not (0 <= self.CHATBOT_PROMPT_AB_BUCKET_RATIO <= 1):
            raise RuntimeError("CHATBOT_PROMPT_AB_BUCKET_RATIO must be between 0 and 1")

        if self.CHATBOT_MAX_CONTEXT_ITEMS_A <= 0:
            raise RuntimeError("CHATBOT_MAX_CONTEXT_ITEMS_A must be positive")

        if self.CHATBOT_MAX_CONTEXT_ITEMS_B <= 0:
            raise RuntimeError("CHATBOT_MAX_CONTEXT_ITEMS_B must be positive")

        if self.CHATBOT_CONTEXT_CHAR_LIMIT_A <= 0:
            raise RuntimeError("CHATBOT_CONTEXT_CHAR_LIMIT_A must be positive")

        if self.CHATBOT_CONTEXT_CHAR_LIMIT_B <= 0:
            raise RuntimeError("CHATBOT_CONTEXT_CHAR_LIMIT_B must be positive")

        if self.CHATBOT_PROMPT_HISTORY_ITEMS_MAX_A <= 0:
            raise RuntimeError("CHATBOT_PROMPT_HISTORY_ITEMS_MAX_A must be positive")

        if self.CHATBOT_PROMPT_HISTORY_ITEMS_MAX_B <= 0:
            raise RuntimeError("CHATBOT_PROMPT_HISTORY_ITEMS_MAX_B must be positive")

        if self.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_A <= 0:
            raise RuntimeError(
                "CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_A must be positive"
            )

        if self.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_B <= 0:
            raise RuntimeError(
                "CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_B must be positive"
            )

        if self.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_A <= 0:
            raise RuntimeError(
                "CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_A must be positive"
            )

        if self.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_B <= 0:
            raise RuntimeError(
                "CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_B must be positive"
            )

        if self.CHATBOT_SESSION_TTL_SECONDS <= 0:
            raise RuntimeError("CHATBOT_SESSION_TTL_SECONDS must be positive")

        if not self.CHATBOT_REDIS_URL:
            raise RuntimeError("CHATBOT_REDIS_URL must not be empty")

        if self.CHATBOT_REDIS_CONNECT_TIMEOUT_SECONDS <= 0:
            raise RuntimeError(
                "CHATBOT_REDIS_CONNECT_TIMEOUT_SECONDS must be positive"
            )

        if self.CHATBOT_REDIS_SOCKET_TIMEOUT_SECONDS <= 0:
            raise RuntimeError("CHATBOT_REDIS_SOCKET_TIMEOUT_SECONDS must be positive")

        if self.CHATBOT_REDIS_RECONNECT_BACKOFF_SECONDS <= 0:
            raise RuntimeError(
                "CHATBOT_REDIS_RECONNECT_BACKOFF_SECONDS must be positive"
            )

        if not self.CHATBOT_MEMORY_KEY_PREFIX:
            raise RuntimeError("CHATBOT_MEMORY_KEY_PREFIX must not be empty")

        if self.CHATBOT_DB_ENABLED and not self.DATABASE_URL:
            raise RuntimeError("DATABASE_URL must not be empty when CHATBOT_DB_ENABLED=true")

        if self.CHATBOT_HISTORY_PAGE_SIZE_DEFAULT <= 0:
            raise RuntimeError("CHATBOT_HISTORY_PAGE_SIZE_DEFAULT must be positive")

        if self.CHATBOT_HISTORY_PAGE_SIZE_MAX <= 0:
            raise RuntimeError("CHATBOT_HISTORY_PAGE_SIZE_MAX must be positive")

        if self.CHATBOT_HISTORY_PAGE_SIZE_DEFAULT > self.CHATBOT_HISTORY_PAGE_SIZE_MAX:
            raise RuntimeError(
                "CHATBOT_HISTORY_PAGE_SIZE_DEFAULT must be <= CHATBOT_HISTORY_PAGE_SIZE_MAX"
            )

        if self.CHATBOT_HISTORY_PERSIST_TIMEOUT_MS <= 0:
            raise RuntimeError("CHATBOT_HISTORY_PERSIST_TIMEOUT_MS must be positive")

        if self.CHATBOT_DB_POOL_SIZE <= 0:
            raise RuntimeError("CHATBOT_DB_POOL_SIZE must be positive")

        if self.CHATBOT_DB_MAX_OVERFLOW < 0:
            raise RuntimeError("CHATBOT_DB_MAX_OVERFLOW must be >= 0")

        if self.CHATBOT_DB_POOL_TIMEOUT_SECONDS <= 0:
            raise RuntimeError("CHATBOT_DB_POOL_TIMEOUT_SECONDS must be positive")

        if self.CHATBOT_DB_POOL_RECYCLE_SECONDS <= 0:
            raise RuntimeError("CHATBOT_DB_POOL_RECYCLE_SECONDS must be positive")

        if self.CHATBOT_DB_COMMAND_TIMEOUT_SECONDS <= 0:
            raise RuntimeError("CHATBOT_DB_COMMAND_TIMEOUT_SECONDS must be positive")

        if not self.ASSISTANT_DOCS_DIR:
            raise RuntimeError("ASSISTANT_DOCS_DIR must not be empty")

        if not self.EMBEDDING_MODEL_NAME:
            raise RuntimeError("EMBEDDING_MODEL_NAME must not be empty")

        if self.EMBEDDING_MAX_LENGTH <= 0:
            raise RuntimeError("EMBEDDING_MAX_LENGTH must be positive")

        if self.EMBEDDING_BATCH_SIZE <= 0:
            raise RuntimeError("EMBEDDING_BATCH_SIZE must be positive")

        if self.EMBEDDING_QUERY_CACHE_SIZE <= 0:
            raise RuntimeError("EMBEDDING_QUERY_CACHE_SIZE must be positive")

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

        if self.RAG_DOC_MAX_CHUNKS_PER_DOC <= 0:
            raise RuntimeError("RAG_DOC_MAX_CHUNKS_PER_DOC must be positive")

        if not self.RAG_DOC_SEARCH_VISIBILITY:
            raise RuntimeError("RAG_DOC_SEARCH_VISIBILITY must not be empty")

        if not self.ES_NODE:
            raise RuntimeError("ES_NODE must not be empty")

        if not self.GROQ_MODEL:
            raise RuntimeError("GROQ_MODEL must not be empty")

        if self.GROQ_TIMEOUT_SECONDS <= 0:
            raise RuntimeError("GROQ_TIMEOUT_SECONDS must be positive")

        if self.CHATBOT_LLM_TIMEOUT_MS <= 0:
            raise RuntimeError("CHATBOT_LLM_TIMEOUT_MS must be positive")

        if self.GROQ_MAX_TOKENS <= 0:
            raise RuntimeError("GROQ_MAX_TOKENS must be positive")

        if not (0 <= self.GROQ_TEMPERATURE <= 2):
            raise RuntimeError("GROQ_TEMPERATURE must be between 0 and 2")


settings = Settings()
