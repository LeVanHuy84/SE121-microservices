# AI Chatbot Service

`ai-chatbot-service` is a FastAPI-based Python backend service. It serves as the core AI engine for the Sentimeta project, responsible for multimodal emotion analysis, content moderation, and orchestrating the Mental Health Chatbot Assistant via RAG (Retrieval-Augmented Generation) architecture.

---

## 1. Core Features

- **Mental Health Assistant (RAG)**: A contextual psychological support chatbot. It retrieves relevant community articles from Elasticsearch based on user queries and chat history to provide empathetic advice.
- **Guardrails (Safety Filters)**: Blocks out-of-scope questions, toxic language (Community Guard), and detects signs of self-harm/mental crisis (Crisis Guard) to emit urgent Kafka alerts without querying the LLM.
- **Emotion & Moderation**: Integrates PhoBERT models for Vietnamese text emotion and moderation, alongside CLIP/FER for image sentiment and facial expression analysis.
- **Streaming & SSE**: Supports Server-Sent Events (SSE) for low-latency, real-time typing experiences.

---

## 2. Runtime Profile

| Component | Technology |
| --- | --- |
| Framework | Python 3.10+ / FastAPI |
| Default Port | `4006` (HTTP) |
| Primary Database | MongoDB (Chat History), Elasticsearch (RAG Vector Search) |
| Cache & Memory | Redis (Short-term session memory) |
| Message Broker | Kafka (Emitting psychological crisis alerts) |
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

The project utilizes `pytest` alongside `Testcontainers` (Automatically downloads and spins up transient Database containers using Docker).

### 🚨 Important Note on Memory Limits (OOM)
The `tests/` directory contains Unit tests (which load heavy AI models like PhoBERT into RAM) AND Integration tests (which spawn Elasticsearch/Mongo Docker containers). **DO NOT** run the blanket `pytest tests/` command on a personal machine, as it will likely cause an Out of Memory (OOM) crash.

Please run the test suites separately to allow memory to be garbage-collected:

#### 5.1. Unit Test & API Contract (Fast & Lightweight)
Tests API schemas, HTTP codes (500, 422), and Guardrails using a Mocked LLM:
```bash
# Requires inline env vars to pass pydantic validation
env PYTHONPATH=. INTERNAL_SERVICE_KEY=x GROQ_API_KEY=x .venv/bin/python -m pytest tests/test_public_api_v1.py -v
```

#### 5.2. Integration Test Database & RAG (Requires Docker Daemon)
Automatically spins up Elasticsearch (memory-limited to 256MB), MongoDB, and Redis via Testcontainers to test real read/write operations:
```bash
env PYTHONPATH=. INTERNAL_SERVICE_KEY=x GROQ_API_KEY=x CHATBOT_DB_ENABLED=true .venv/bin/python -m pytest tests/test_integration.py -v
```

#### 5.3. Core AI Model Tests
```bash
env PYTHONPATH=. INTERNAL_SERVICE_KEY=x GROQ_API_KEY=x .venv/bin/python -m pytest tests/test_emotion_aware.py tests/test_crisis_guard.py -v
```

#### 5.4. Viewing Coverage Reports
Append the `--cov=app` flag to any of the above commands. Requirement: Core business logic coverage >= 80%.
```bash
env PYTHONPATH=. INTERNAL_SERVICE_KEY=x GROQ_API_KEY=x .venv/bin/python -m pytest --cov=app tests/test_public_api_v1.py
```
