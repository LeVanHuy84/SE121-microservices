# AI Chatbot Service

## Overview

FastAPI-based Python microservice acting as the core AI engine for Sentimeta. Responsible for multimodal emotion analysis (PhoBERT text emotion, FER image sentiment, MERT audio features), content moderation, and orchestrating the Dual-Domain AI Chatbot Assistant:

1. **Sentimeta System Guidance & In-App Actions:** Guiding users through application features (`topic: huong-dan`), tracking active screen context (`SurfaceContext`), providing direct navigation (`NavigateAction`), rich cards (`ShowCardAction`), and write action proposals guarded by **Zero Silent Mutation** (`ProposeAction`).
2. **Stepped Mental Health Companion (Tiers 1–3):** Delivering stepped psychological care from sub-50ms crisis intervention (Tier 1), acute psychological first aid (Tier 2 PFA Mode: Look - Listen - Link), to empathetic cognitive reframing (Tier 3 Socratic / CBT Mode) via a Cross-Lingual Hybrid RAG engine (Elasticsearch vector + BM25 with normalized RRF `(0.0, 1.0]` and bounded lexical scores `[0.0, 0.30]`), multi-session MongoDB memory v2, and true token-by-token Groq LLM streaming (TTFT < 800ms).

## Interface

- **Internal Gateway HTTP Endpoints** (`app/modules/chatbot/router.py`, prefix `/assistant`, requires `X-Internal-Key`):
  - `POST /assistant/respond`: Synchronous turn execution with Two-Stage Scope & Grounding Gate, context window loading, and action proposal synthesis.
  - `POST /assistant/respond-stream`: Real-time Server-Sent Events (SSE) streaming endpoint (< 800ms TTFT) emitting incremental text chunks, citation references (`[1]`, `[2]`), and structured action proposals/cards (`AssistantRespondData`).
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
- **Message Streams (Kafka)**:
  - Consumer (`user-events` topic, group `{client_id}-chatbot-user`): Consumes `user.removed` account deletion events and executes full cascade purge (`purge_user_data(include_emotion_cache=True)` + `action_audit_logger.purge_user`), re-raising on failure for retry/DLQ.
  - Consumer (`analysis-result-events` topic, group `{client_id}-chatbot-emotion`): Captures post/media analysis results and updates the acute Redis Hash `chatbot:emotion:acute:{user_id}` (`EmotionContextService.update_acute_cache`) without overwriting `emotion:longitudinal:{user_id}`.
  - Publisher (`chatbot.crisis.alert` topic): Emits urgent psychological crisis alerts bounded to a 28ms Kafka wait with immediate local MongoDB Outbox fallback (`outbox_repo.save_outbox`).

## Invariants

- `INTERNAL_SERVICE_KEY` header must accompany incoming internal gateway requests.
- **Stepped Mental Health Care Execution (Tiers 1–3) & Tone Isolation**:
  - _Tier 1 (Immediate Crisis Intervention)_: Triggers on explicit self-harm or severe hopelessness patterns in `< 50ms`, publishes alert to Kafka (`chatbot.crisis.alert`) with bounded 28ms timeout (and MongoDB Outbox fallback), and returns 24/7 hotlines (`1900 599 830`, `111`) without invoking LLM inference.
  - _Tier 2 (Acute Psychological First Aid — PFA Mode)_: Activates on `distress_level == "acute_pfa"` (somatic panic/exhaustion cues or `PhoBERTModerator` `EMOTIONAL_CRISIS >= 0.45`) or active `session_emotional_state.active_tier == "TIER_2_PFA"` (when not `is_system_turn`); delivers Look - Listen - Link somatic stabilization (`4-7-8` breathing, `5-4-3-2-1` grounding, ACBT) and strictly prohibits analytical or Socratic probing questions.
  - _Tier 3 (Empathetic Socratic / CBT Mode)_: Activates on `distress_level == "mild_cbt"` or in-chat distress; follows a 3-step response (natural validation without citations, plain-Vietnamese coping skills translated from RAG citing `[1]`, `[2]` personalized with `USER_FACTS`, and at most one gentle Socratic open-ended question). Strictly forbids medical/psychiatric diagnosis.
  - _System Turn Tone Isolation (`is_system_turn`)_: `_is_mental_health_turn` does not fall back to `emotion_snapshot`; product/feature turns (`is_system_turn == True`) suppress carryover therapy tone and reset `session_emotional_state` when `distress_level == "none"`.
  - _Multi-Turn Session Emotional State (`session_emotional_state`)_: Persists `active_tier`, `remaining_turns_ttl=3`, and `topic_anchor` on `chat_conversations` so short follow-ups (`<= 12` tokens) retain clinical tone and RAG context until TTL expires, `is_system_turn` is `True`, or a positive-recovery closure cue is matched.
- **Fail-Closed `aiPolicy` Guard & 2-Tier Tool Routing**:
  - `aiPolicy` defaults to `"RESTRICTED"` (`Literal["FULL", "RESTRICTED"]`). Under `RESTRICTED`, personal memory (`user_facts`, `memory_summary`), `emotion_snapshot`, personal `contexts`, and background `FactExtractorService` are skipped while safety guardrails (`CrisisGuard`, `CommunityGuard`, `ScopeGuard`) remain active.
  - `NavResolver` and `ToolRouter` filter by `policy_scope` (`"public"` vs `"personal"`). `ToolRouter.route` uses 2-tier routing (Tier 1 intent overlay + Tier 2 surface anchor, max 6 tools) and `ToolDispatcher.dispatch` enforces defense-in-depth by blocking non-`"public"` tools under `RESTRICTED`.
- **Zero Silent Mutation & Action Hardening**: Chatbot never mutates application state without user consent; write actions are emitted as `ProposeAction` cards (suppressed under `RESTRICTED`) signed with HMAC-SHA256 `proposalToken` binding `(userId, conversationId, actionId, actionName, paramsHash, idempotencyKey, expiresAt)`. `POST /assistant/actions/execute` verifies `aiPolicy == "FULL"`, allowlist, `proposalToken`, entity ID format (`^[a-zA-Z0-9_-]{1,128}$`), blocks mock fallbacks in production (`APP_ENV == "production"`), enforces fail-closed Redis `SET NX` + Lua lease-release idempotency (`503` on Redis unavailable, `409` on in-flight), and writes append-only audit logs (`chatbot_action_audit_logs`, 90-day TTL).
- **Two-Stage Cascading Hybrid Guard & Grounding Gate**:
  - _Stage 1 (Lexical Gate, `<1ms`)_: Runs `CrisisGuard`, `CommunityGuard` (separating hard `unsafe_content` from `profanity_candidate`), and `AssistantScopeGuard` (`ScopeGuard`).
  - _Stage 2 (`Stage2GuardVerifier`, `250ms` timeout budget)_: Triggered for `profanity_candidate`, non-greeting out-of-scope candidates (`confidence <= 0.15`), grey-zone queries (`0.15 < score < 0.45`), or `distress_level != "none"`. Runs ONNX E5 centroid cosine similarity (`mental_health`, `system_guide`, `implicit_crisis`) and `PhoBERTModerator` in parallel on `CHATBOT_ML_EXECUTOR`, sharing normalized queries (`normalize_query_text()`) via `EmbeddingService._query_cache`.
  - _Post-RAG Grounding Gate_: Returns `_in_domain_unknown_response` when RAG returns 0 chunks for unindexed application feature questions, preventing LLM hallucinations.
- **Cross-Lingual RAG Tiering & Decoupled Hybrid Queries**:
  - Corpus Tiering (`docs/assistant/*.md`): Documents are tagged with `tier` (`actionable_worksheet`, `clinical_reference`, `background_theory`, `system_guide`); non-clinical books/meta-analyses are excluded via `visibility: archived`. Mental health turns boost `actionable_worksheet` (`1.55x` Tier 2 PFA / `1.45x` Tier 3 CBT) and `clinical_reference` (`1.15x`), while down-ranking `background_theory` (`0.55x`).
  - Decoupled Queries: Dense vector search (`_search_vector`) uses the unexpanded `dense_query` (reusing Stage 2's `_query_cache` hit), while `_expand_mental_health_query()` keyword expansion is applied exclusively to `_search_bm25()`.
  - Normalized RRF & Bounded Lexical Tie-Breaker: Scores bounded in `(0.0, 1.0]` with lexical tie-breaker capped at `[0.0, 0.30]`.
- **Isolated ML Executors & Lock-Free ONNX Inference**: `CHATBOT_ML_EXECUTOR` (`max_workers=4`) isolates interactive turn embeddings and Stage 2 `PhoBERTModerator` calls from background Kafka analysis and RAG batch indexing on `ANALYSIS_ML_EXECUTOR` (`max_workers=1`). `InferenceSession.run()` runs lock-free with `intra_op_num_threads=1` and `inter_op_num_threads=1`, while `AutoTokenizer` calls use `_tokenizer_lock`.
- **Multi-Provider Circuit Breaker & Background Quota Isolation**: `ResilientLlmProvider` wraps `GroqProvider` (primary) and `OpenAICompatibleFallbackProvider` (Gemini/OpenAI via pooled `httpx.AsyncClient`, `UVICORN_WORKERS=1` in-memory circuit breaker). Pre-first-token SSE failures fail over transparently to fallback; mid-stream drops trip the breaker, emit a truncation notice, and `RespondCommand._finalize_streamed_response()` strips the footer and skips `FactExtractorService`. Background `FactExtractorService` is gated by `_SlidingWindowRateLimiter` (`FACT_EXTRACTOR_RPM_LIMIT`, `allow_paid_fallback=False`).
- **Zero Cross-Conversation Context Leakage**: Every conversation is strictly isolated by its resolved UUID; `"default"` is never returned or reused across distinct threads.
- **Token-Budgeted Context Continuity**: Turns with $\le 1,500$ estimated tokens load full history; turns with $> 1,500$ tokens load the substantive anchor exchange, a system gap marker (`GAP_MARKER_TEXT`), and up to 3 recent turns within a 2,000-token hard ceiling.
- **Multi-Session Quota & LRA Eviction**: Maximum 20 active conversations per user. Creating the 21st session synchronously marks the oldest active session as `status: "tombstoned"` and schedules an asynchronous cascade delete.
- **90-Day Rolling Inactivity Window**: Sessions inactive for >90 days are excluded from read queries and purged in batches (200) by the periodic lifespan sweeper loop (`run_sweeper_loop`).
- **Split-Field Redis Emotion Hashes**: Redis is excluded from chat history and used via a single `PIPELINE HGETALL` across `chatbot:emotion:acute:{user_id}` (written by `ai-chatbot-service`) and `emotion:longitudinal:{user_id}` (read-only, written by `emotion-intelligence-service`).

## Side Effects

- Reads, inserts, and atomically updates MongoDB collections: `chat_conversations` (metadata, `session_emotional_state`, token counts, anchor exchange), `chat_messages` (user/assistant messages), `user_memory_profiles` (8 durable canonical fact keys), `chatbot_outbox_events` (local Outbox fallback for crisis alerts), and `chatbot_action_audit_logs` (append-only write-action audit trail with 90-day TTL).
- Writes acute post emotion snapshots to Redis (`chatbot:emotion:acute:{user_id}`, TTL `86400s`) and distributed action idempotency leases (`chatbot:action:idem:{user_id}:{idempotency_key}`).
- Deletes all user records across MongoDB collections (`chat_conversations`, `chat_messages`, `user_memory_profiles`, `chatbot_action_audit_logs`) on `DELETE /history/me` / Kafka `user.removed` and deletes Redis emotion cache on Kafka `user.removed`.
- Executes periodic batch deletion sweeps for tombstoned and 90-day inactive conversations and messages.
- Emits real-time emergency events to Kafka (`chatbot.crisis.alert`).
- Makes outbound HTTPS requests to Groq Cloud API for LLM completions.

## Verification

- Monorepo & Virtualenv Runner:
  ```bash
  npm --workspace=ai-chatbot-service run test
  npm --workspace=ai-chatbot-service run lint
  ```
- Specific Memory v2, Stage 2 Guard, Fallback, & Golden Eval Unit Tests:
  ```bash
  .venv/bin/python -m unittest tests/unit/test_chatbot_memory_v2.py tests/unit/test_context_resolver_emotion.py tests/unit/test_emotion_aware.py tests/unit/test_stage2_hybrid_guard.py tests/unit/test_resilient_provider.py tests/unit/test_golden_eval_harness.py
  ```
- Offline 64-Case Golden Evaluation Harness (`evaluation/golden_eval/`):
  ```bash
  env PYTHONPATH=. UNIT_TEST_MODE=true CHATBOT_REDIS_ENABLED=false MOCK_EXTERNAL_MODELS=true .venv/bin/python -m evaluation.golden_eval.runner
  ```
- All Unit Test Suites (via unittest discovery):
  ```bash
  .venv/bin/python -m unittest discover -s tests -p "test_*.py"
  ```
- **2-Layer Live Verification (Cross-Service Integration & Groq Smoke):**
  1. Start baseline infrastructure and verify `DATABASE_URL` (PostgreSQL) and `MONGO_URL` (MongoDB):
     ```bash
     docker-compose up -d redis elasticsearch kafka
     ```
  2. Start the required service slice:
     - **Slice 1A (Gateway, Auth, Privacy Gate, Memory v2, Multi-Session):** `user-social-service` (`4001`), `api-gateway` (`4000`, `ENABLE_LOAD_TEST_MODE=true`), and `ai-chatbot-service` (`4006`, `CHATBOT_LLM_STUB_MODE=true`).
     - **Slice 1B (Tools, Navigation & Actions):** Slice 1A + `content-feed-service` (`4002`), `search-recommendation-service` (`4003`), `emotion-intelligence-service` (`4005`).
     - **Slice 1C (Kafka Proactive Intervention):** `emotion-intelligence-service` (`4005`) + `ai-chatbot-service` (`4006`).
  3. Run Layer 1 (deterministic LLM stub, prefix-scoped `mock_user_e2e_<runId>_` teardown):
     ```bash
     npm --workspace=ai-chatbot-service run test:live:layer1
     ```
  4. Run Layer 2 (opt-in real Groq smoke suite, requires `GROQ_API_KEY`):
     ```bash
     npm --workspace=ai-chatbot-service run test:live:layer2
     ```

---

## 1. Core Features

- **Mental Health Assistant (RAG & Memory v2)**: A contextual psychological support chatbot with multi-session isolation, token-budgeted anchor preservation, and durable cross-session personal facts. Retrieves relevant community articles from Elasticsearch based on user queries and chat history to provide empathetic advice.
- **Guardrails (Safety Filters)**: Blocks out-of-scope questions, toxic language (Community Guard), and detects signs of self-harm/mental crisis (Crisis Guard) to emit urgent Kafka alerts without querying the LLM.
- **Emotion & Moderation**: Integrates PhoBERT models for Vietnamese text emotion and moderation, alongside CLIP/FER for image sentiment and facial expression analysis.
- **Streaming & SSE**: Supports Server-Sent Events (SSE) for low-latency, real-time typing experiences.

---

## 2. Runtime Profile

| Component        | Technology                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework        | Python 3.10+ / FastAPI                                                                                                                             |
| Default Port     | `4006` (HTTP)                                                                                                                                      |
| Primary Database | MongoDB (`chat_conversations`, `chat_messages`, `user_memory_profiles`), Elasticsearch (RAG Vector Search)                                         |
| Cache & Memory   | Redis (Split-field emotion hashes: `chatbot:emotion:acute:{user_id}` & read-only `emotion:longitudinal:{user_id}`; chat history in MongoDB)        |
| Message Broker   | Kafka (emits crisis alerts to `crisis-alerts`; consumes `user-events` for account deletion purge and `analysis-result-events` for emotion updates) |
| LLM Provider     | `ResilientLlmProvider`: Groq primary (`Llama-3`) with circuit-breaker failover to Gemini/OpenAI (`OpenAICompatibleFallbackProvider`)               |

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

Copy `.env.example` to `.env` (or `.env.local`) and configure the required parameters:

```ini
PORT=4006
HOST=0.0.0.0
APP_ENV=development                             # "development" | "staging" | "production"
INTERNAL_SERVICE_KEY=chatbot-internal-secret    # Required for gateway authentication
PROPOSAL_HMAC_KEY=                              # Required in production for signing proposalToken
PROPOSAL_TOKEN_TTL_SECONDS=900                  # 15-minute TTL for proposalToken
TOOL_ENABLE_MOCK_FALLBACKS=false                # Must be false when APP_ENV=production
GROQ_API_KEY=gsk_your_real_key_here             # Primary Groq API key (Required)
CHATBOT_DB_ENABLED=true                         # Enable database connectivity
MONGO_URL=mongodb://localhost:27017             # Local DB URI
CHATBOT_REDIS_URL=redis://localhost:6379/0
ES_NODE=http://localhost:9200

# Multi-Provider LLM Circuit Breaker & Fallback
LLM_FALLBACK_ENABLED=true
LLM_FALLBACK_PROVIDER=gemini                    # "gemini" | "openai"
LLM_FALLBACK_API_KEY=                           # Required for fallback (disabled if blank)
LLM_FALLBACK_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
LLM_FALLBACK_MODEL=gemini-2.5-flash
LLM_CIRCUIT_BREAKER_FAILURE_THRESHOLD=3
LLM_CIRCUIT_BREAKER_COOLDOWN_SECONDS=30.0
FACT_EXTRACTOR_RPM_LIMIT=10                     # Sliding-window RPM cap for background fact extraction

# Offline test suite flags (defaults when running unit tests offline)
UNIT_TEST_MODE=false
CHATBOT_REDIS_ENABLED=true
MOCK_EXTERNAL_MODELS=false
```

> **Operational Constraint (`workers=1`)**: `ResilientLlmProvider` maintains an in-memory circuit breaker. Run Uvicorn with a single worker (`--workers 1` / `UVICORN_WORKERS=1`) so circuit-breaker state (`CLOSED`/`OPEN`/`HALF_OPEN`) and `_SlidingWindowRateLimiter` remain consistent across requests.

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

If your databases are already running in the background, you can start the API server manually (keep single worker `--workers 1`):

```bash
uvicorn app.main:app --reload --port 4006 --workers 1
```

---

## 5. Seeding RAG Data (Elasticsearch)

If you are running the backend on a fresh Elasticsearch instance or after updating `docs/assistant/*.md` frontmatter (`tier`, `visibility`), re-index the markdown guideline documents into Elasticsearch.

Make sure your `.env` is loaded and `elasticsearch` is running, then run from the monorepo root:

```bash
npm --workspace=ai-chatbot-service run rag:index-docs
```

Or directly inside `apps/ai-chatbot-service`:

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
