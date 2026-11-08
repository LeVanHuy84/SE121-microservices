import os

# Set unit test offline environment variables
os.environ.setdefault("UNIT_TEST_MODE", "true")
os.environ.setdefault("CHATBOT_REDIS_ENABLED", "false")
os.environ.setdefault("MOCK_EXTERNAL_MODELS", "true")
os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ.setdefault("CHATBOT_DB_ENABLED", "false")

