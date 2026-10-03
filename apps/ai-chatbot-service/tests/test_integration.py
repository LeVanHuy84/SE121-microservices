import asyncio
import os
import pytest
from datetime import datetime, timezone
from testcontainers.mongodb import MongoDbContainer
from testcontainers.redis import RedisContainer
from testcontainers.elasticsearch import ElasticSearchContainer

from app.modules.chatbot.repositories.chat_history import ChatHistoryRepository
from app.modules.chatbot.services.memory import SessionMemory
from app.modules.chatbot.services.rag_engine import RagDocumentService
from app.core.database import get_database, init_database, close_database
from app.core.settings import settings

@pytest.mark.asyncio
async def test_mongo_history_store():
    with MongoDbContainer("mongo:6.0") as mongo:
        # Override settings
        settings.MONGO_URL = mongo.get_connection_url()
        settings.MONGO_DB = "test_chatbot"
        
        # Init DB
        init_database()
        db = get_database()
        
        repo = ChatHistoryRepository(db)
        
        # Test get_or_create_conversation_by_user
        user_id = "test-integration-user"
        conv = await repo.get_or_create_conversation_by_user(user_id)
        assert conv["user_id"] == user_id
        
        # Test append_exchange
        await repo.append_exchange(
            user_id=user_id,
            user_message="Hello",
            assistant_reply="Hi there",
            intent="greeting",
            sources=[],
            client_message_id="msg-123"
        )
        
        # Test list_messages_by_user
        messages, has_more = await repo.list_messages_by_user(user_id, page_size=10)
        assert len(messages) == 2
        assert not has_more
        
        # The latest message is first in the list
        assert messages[0]["role"] == "assistant"
        assert messages[0]["content"] == "Hi there"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "Hello"
        
        # Test clear_history
        deleted = await repo.clear_history_by_user(user_id)
        assert deleted == 2
        
        messages_after, _ = await repo.list_messages_by_user(user_id, page_size=10)
        assert len(messages_after) == 0
        
        await close_database()

@pytest.mark.asyncio
async def test_redis_session_memory():
    with RedisContainer("redis:7") as redis_container:
        redis_host = redis_container.get_container_host_ip()
        redis_port = redis_container.get_exposed_port(6379)
        settings.REDIS_HOST = redis_host
        settings.REDIS_PORT = redis_port
        
        # Test SessionMemory
        memory = SessionMemory()
        
        session_key = "test_user:default"
        memory.update_session_batch(
            key=session_key,
            user_message="Hello world",
            assistant_reply="Hi there",
            summary="User said hello",
            intent="greeting",
            sources=[],
            facts={"last_intent": "greeting"}
        )
        
        summary = memory.get_summary(session_key)
        assert summary == "User said hello"
        
        intent = memory.get_last_intent(session_key)
        assert intent == "greeting"
        
        facts = memory.get_facts(session_key)
        assert facts["last_intent"] == "greeting"
        
        recent = memory.get_recent(session_key, 5)
        assert len(recent) == 2
        assert recent[-1].role == "assistant"
        
        memory.clear_session(session_key)
        assert memory.get_summary(session_key) == ""
        assert memory.get_recent(session_key, 5) == []

@pytest.mark.asyncio
async def test_rag_document_service():
    with ElasticSearchContainer("docker.elastic.co/elasticsearch/elasticsearch:8.11.0") as es_container:
        es_host = es_container.get_container_host_ip()
        es_port = es_container.get_exposed_port(9200)
        es_url = f"http://{es_host}:{es_port}"
        settings.ES_NODE = es_url
        
        rag = RagDocumentService()
        
        # Index documents
        result = await rag.index_assistant_docs(force_reindex=True)
        assert result["documents"] > 0
        assert result["chunks"] > 0
        
        # Search documents
        hits = await rag.search_assistant_docs("Tính năng chat", top_k=3)
        assert len(hits) > 0
        
        await rag.close()
