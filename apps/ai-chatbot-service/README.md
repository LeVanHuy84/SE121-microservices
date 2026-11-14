# AI Chatbot Service

## Overview
FastAPI-based Python microservice acting as the core AI engine for Sentimeta. Responsible for multimodal emotion analysis, content moderation (PhoBERT for Vietnamese text, CLIP/FER for image sentiment and facial expressions), and orchestrating the Mental Health Chatbot Assistant via a MongoDB-centric memory architecture (v2), Elasticsearch RAG pipeline, and Groq LLM inference.

## Interface
- **Internal Gateway HTTP Endpoints** (`app/modules/chatbot/router.py`, prefix `/assistant`, requires `X-Internal-Key`):
  - `POST /assistant/respond`: Synchronous turn execution with context window loading and action proposal synthesis.
  - `POST /assistant/respond-stream`: Streaming Server-Sent Events (SSE) endpoint for low-latency incremental responses.
  - `GET /assistant/history/{user_id}`: Cursor-paginated message history for a user and optional `conversation_id`.
  - `DELETE /assistant/history/{user_id}`: Hard purge of all user chat history and memory profiles (`ClearHistoryCommand`).
  - `GET /assistant/conversations/{user_id}`: Lists active conversations (up to 20, sorted by `last_message_at DESC`).
  - `POST /assistant/conversations/{user_id}`: Explicitly creates a new active session with a fresh UUID.
  - `DELETE /assistant/conversations/{user_id}/{conversation_id}`: Deletes a specific conversation and cascades to its messages.
  - `POST /assistant/actions/execute`: Executes proposed navigation/system actions (with idempotency and policy gates).
  - `POST /assistant/actions/click`: Telemetry logging for proposed action clicks.
- **Public API v1 Endpoints** (`app/modules/chatbot/public_router.py`, prefix `/v1/assistant`, requires `X-Internal-Key` + `X-User-Id`):
  - `POST /v1/assistant/respond`
  - `POST /v1/assistant/respond-stream`
  - `GET /v1/assistant/history/me` (supports `conversationId` filter)
  - `DELETE /v1/assistant/history/me`
  - `GET /v1/assistant/conversations`
  - `POST /v1/assistant/conversations`
  - `DELETE /v1/assistant/conversations/{conversation_id}`
- **Analysis Endpoints** (`app/modules/analysis/router.py`, prefix `/analysis`):
  - `POST /analysis/text-emotion`: PhoBERT Vietnamese emotion classification.
  - `POST /analysis/moderation`: Toxicity, profanity, and self-harm text moderation.
  - `POST /analysis/image-emotion`: Face and visual sentiment analysis.
- **Message Streams (Kafka & RabbitMQ)**:
  - Consumer (`user-events` topic, group `{client_id}-chatbot-user`): Consumes `user.removed` account deletion events and executes full cascade purge (`purge_user_data(include_emotion_cache=True)`).
  - Consumer (`analysis-result-events` topic, group `{client_id}-chatbot-emotion`): Captures analysis results and updates the 5-minute Redis emotion cache (`EmotionContextService`).
  - Publisher (`crisis-alerts` topic): Emits urgent psychological crisis alerts on high-risk disclosures without calling external LLM APIs.

## Invariants
- `INTERNAL_SERVICE_KEY` header must accompany incoming internal gateway requests.
- **Zero Cross-Conversation Context Leakage**: Every conversation is strictly isolated by its resolved UUID; `"default"` is never returned or reused across distinct threads.
- **Token-Budgeted Context Continuity**: Turns with $\le 1,500$ estimated tokens load full history; turns with $> 1,500$ tokens load the substantive anchor exchange, a system gap marker (`GAP_MARKER_TEXT`), and up to 3 recent turns within a 2,000-token hard ceiling.
- **Multi-Session Quota & LRA Eviction**: Maximum 20 active conversations per user. Creating the 21st session synchronously marks the oldest active session as `status: "tombstoned"` and schedules an asynchronous cascade delete.
- **90-Day Rolling Inactivity Window**: Sessions inactive for >90 days are excluded from read queries and purged in batches (200) by the periodic lifespan sweeper loop (`run_sweeper_loop`).
- **Guard-Safe Asynchronous Fact Extraction**: Up to 8 durable canonical trait keys (`name`, `occupation`, `work_mode`, `sleep_health`, `diet_exercise`, `interests`, `current_goal`, `tone_preference`, max 100 chars each) are extracted in background tasks bounded by `asyncio.Semaphore(2)`. Extraction is strictly blocked on policy-blocked, crisis, community-violation, and out-of-scope turns.
- **Crisis Guard Safety Interception**: Must intercept explicit self-harm or severe crisis signals and emit urgent Kafka alerts immediately without calling external LLM APIs.
- **Deprecated Redis SessionMemory**: Redis is excluded from chat history and reserved exclusively for the 5-minute rolling emotion snapshot (`chatbot:emotion:{user_id}`).

## Side Effects
- Reads, inserts, and atomically updates MongoDB collections: `chat_conversations` (metadata, token counts, anchor exchange), `chat_messages` (user/assistant messages), and `user_memory_profiles` (8 durable canonical fact keys).
- Writes 5-minute emotion analysis snapshot to Redis (`chatbot:emotion:{user_id}`).
- Deletes all user records across MongoDB collections (`chat_conversations`, `chat_messages`, `user_memory_profiles`) on `DELETE /history/me` and deletes Redis emotion cache on Kafka `user.removed`.
- Executes periodic batch deletion sweeps for tombstoned and 90-day inactive conversations and messages.
- Emits real-time emergency events to Kafka (`crisis-alerts`).
- Makes outbound HTTPS requests to Groq Cloud API for LLM completions.

## Verification
- Unit Tests:
  ```bash
  .venv/bin/python -m unittest tests/unit/test_chatbot_memory_v2.py tests/unit/test_chat_history_actions.py tests/unit/test_assistant_service.py
  ```
- All Unit Test Suites:
  ```bash
  .venv/bin/python -m unittest discover -s tests/unit -p "test_*.py"
  ```

---

## 1. Core Features

- **Mental Health Assistant (RAG & Memory v2)**: A contextual psychological support chatbot with multi-session isolation, token-budgeted anchor preservation, and durable cross-session personal facts. Retrieves relevant community articles from Elasticsearch based on user queries and chat history to provide empathetic advice.
- **Guardrails (Safety Filters)**: Blocks out-of-scope questions, toxic language (Community Guard), and detects signs of self-harm/mental crisis (Crisis Guard) to emit urgent Kafka alerts without querying the LLM.
- **Emotion & Moderation**: Integrates PhoBERT models for Vietnamese text emotion and moderation, alongside CLIP/FER for image sentiment and facial expression analysis.
- **Streaming & SSE**: Supports Server-Sent Events (SSE) for low-latency, real-time typing experiences.

---

## 2. Runtime Profile

| Component | Technology |
| --- | --- |
| Framework | Python 3.10+ / FastAPI |
| Default Port | `4006` (HTTP) |
| Primary Database | MongoDB (`chat_conversations`, `chat_messages`, `user_memory_profiles`), Elasticsearch (RAG Vector Search) |
| Cache & Memory | Redis (5-minute emotion snapshot caching only; chat history fully in MongoDB) |
| Message Broker | Kafka (emits crisis alerts to `crisis-alerts`; consumes `user-events` for account deletion purge and `analysis-result-events` for emotion updates) |
| LLM Provider | Groq (Llama-3) |

---

## 3. Local Development Setup

### 3.1. Virtual Environment
It is highly recommended to use a virtual environment to isolate dependencies:

```bash
# Navigate to the project directory
cd apps/ai-chatbot-service

# Create virtual environment
python -m venv .venv

# Activate virtual environment
source .venv/bin/activate      # On Linux/Mac
.venv\Scripts\activate         # On Windows

# Install dependencies
pip install -r requirements.txt
```

### 3.2. Environment Variables (`.env`)
Create an `.env.production.local` file based on `.env.production.example` and populate it with the following required parameters:

```ini
PORT=4006
HOST=0.0.0.0
INTERNAL_SERVICE_KEY=chatbot-internal-secret    # Required for gateway authentication
GROQ_API_KEY=gsk_your_real_key_here             # Groq API key (Required)
CHATBOT_DB_ENABLED=true                         # Enable database connectivity
MONGO_URL=mongodb://localhost:27017             # Local DB URI
CHATBOT_REDIS_URL=redis://localhost:6379/0
ES_NODE=http://localhost:9200
```

---

## 4. Running the Application

### Full Stack via Docker Compose (Recommended)
Since the app relies on multiple databases, using `docker-compose` at the root directory is the best approach:
```bash
# Spin up all databases and dependent microservices
cd ../../
docker-compose up -d redis kafka elasticsearch api-gateway ai-chatbot-service
```

### Manual Execution (For Code/Debug purposes)
If your databases are already running in the background, you can start the API server manually:
```bash
uvicorn app.main:app --reload --port 4006
```

---

## 5. Seeding RAG Data (Elasticsearch)
If you are running the backend on a fresh Elasticsearch instance, the RAG database will be empty. You need to index the markdown guideline documents into Elasticsearch so the Chatbot has psychological contexts to retrieve from.

Make sure your `.env` is loaded and `elasticsearch` is running, then run:
```bash
env PYTHONPATH=. .venv/bin/python -m app.tools.index_assistant_docs --force
```
You should see an output indicating the number of documents successfully indexed.

---

## 6. Testing Guide

The project utilizes `unittest` / `pytest` alongside `Testcontainers` (Automatically downloads and spins up transient Database containers using Docker).

### 6.1. Unit Test & API Contract (Fast & Lightweight)
Tests API schemas, HTTP codes, Multi-Session Memory v2, and Guardrails using a Mocked LLM:
```bash
env PYTHONPATH=. .venv/bin/python -m unittest tests/unit/test_chatbot_memory_v2.py tests/unit/test_chat_history_actions.py tests/unit/test_assistant_service.py
```

### 6.2. Integration Test Database & RAG (Requires Docker Daemon)
Automatically spins up Elasticsearch (memory-limited to 256MB), MongoDB, and Redis via Testcontainers to test real read/write operations:
```bash
env PYTHONPATH=. INTERNAL_SERVICE_KEY=x GROQ_API_KEY=x CHATBOT_DB_ENABLED=true .venv/bin/python -m pytest tests/test_integration.py -v
```

### 6.3. Core AI Model Tests
```bash
env PYTHONPATH=. INTERNAL_SERVICE_KEY=x GROQ_API_KEY=x .venv/bin/python -m pytest tests/test_emotion_aware.py tests/test_crisis_guard.py -v
```
