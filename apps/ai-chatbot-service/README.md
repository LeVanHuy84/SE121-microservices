# ai-chatbot-service

The ai-chatbot-service is a FastAPI-based Python AI engine. It conducts multimodal emotion & moderation analysis and powers the conversational RAG chatbot assistant.

## Responsibilities

- **Emotion & Moderation Analysis**: Apply PhoBERT for Vietnamese text emotion analysis, and CLIP / FER for image sentiment and facial expression parsing.
- **RAG Chatbot Assistant**: Retrieve relevant documents from Elasticsearch and call LLMs (Groq) to answer user mental health queries with context-aware session history.
- **Access Guardrails**: Enforce strict internal header verification via `X-Internal-Key`.

## Runtime Profile

| Item | Value |
| --- | --- |
| Service type | FastAPI / Python 3.10+ |
| Port | `PORT` or `4006` (HTTP) |
| Transports | HTTP, Kafka |
| Primary storage | Elasticsearch (RAG Index), MongoDB (History) |
| Cache / Buffer | Redis |
| Shared packages | None |

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP server port | `4006` |
| `HOST` | HTTP bind host | `0.0.0.0` |
| `INTERNAL_SERVICE_KEY` | Header key for backend authentication | `chatbot-internal-key-123` |
| `GROQ_API_KEY` | Groq API Key for LLM completions | — |
| `GROQ_MODEL` | Groq model selection | `llama-3.1-8b-instant` |
| `CHATBOT_REDIS_URL` | Redis URL for session memory | `redis://localhost:6379/0` |
| `ES_NODE` | Elasticsearch endpoint | `http://localhost:9200` |
| `RAG_INDEX_NAME` | RAG documents Elasticsearch index | `assistant_rag_documents` |

## Development

```bash
# Setup virtual environment
python -m venv .venv
source .venv/bin/activate # or .venv\Scripts\activate on Windows

# Install requirements
pip install -r requirements.txt

# Start FastAPI server
uvicorn app.main:app --reload --port 4006
```
