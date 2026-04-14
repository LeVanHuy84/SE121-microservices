# Recommendation Service

Python/FastAPI microservice that owns friend recommendation retrieval and semantic ranking.

Current architecture is centralized in this service:

- build candidates from online ANN retrieval (pgvector)
- apply graph projection filtering (exclude self, blocked, existing friend edges)
- rerank with semantic model scores and graph feature boosts
- apply global fallback when primary retrieval is empty or insufficient
- return cursor-based paginated result

`social-service` is now a thin orchestrator that calls `/recommend/query` and hydrates profile cards.

## Data Flow

1. User/social changes publish profile and graph events.
2. `recommendation-service` consumes events and updates projection + embeddings.
3. Processor refreshes global fallback materialization.
4. Query pipeline serves online-first recommendation requests.

## Retrieval Strategy

Primary path:

- semantic online retrieval from pgvector (`source=semantic_online`)
- graph feature rerank from pair features such as mutual friends and common groups
- Redis query cache with event-driven invalidation

Fallback path:

- global fallback table (`recommendation_global_fallback_candidates`) for cold start
  and degraded online retrieval (`source=global_fallback`)
- hybrid response when semantic online provides only partial page (`source=hybrid`)

## API

All endpoints require header `x-internal-key`.

### POST /recommend/query

Main recommendation endpoint.

Request fields:

- `viewerId` (required)
- `limit` (default 20)
- `cursor` (optional)
- `viewerProfileText` (optional fallback when viewer embedding text is missing)

Response contains:

- `source`, `scoreVersion`, `candidateCount`
- ordered `candidates` with `retrievalScore`, `modelScore`, `finalScore`, `reasonCodes`, `rank`
- `nextCursor`, `hasNextPage`

### GET /ready

Readiness endpoint for model/runtime health.

### GET /recommend/query-cache

Internal cache diagnostics endpoint. Returns cache backend, TTL, max entries,
entry count, viewer count, hits, misses, sets, evictions, invalidations, clears,
and Redis errors when Redis is enabled.

Current recommendation API surface is query-first:

- `POST /recommend/query`
- `GET /recommend/query-cache`
- `GET /health`
- `GET /ready`

## Storage and Migrations

- PostgreSQL + SQLAlchemy + Alembic
- pgvector extension for vector search
- HNSW index over `profile_embeddings.embedding_vector`

Migrations:

- `20260410_0001_initial_recommendation_state.py`
- `20260413_0004_add_pgvector_profile_embeddings.py`
- `20260413_0005_add_global_fallback_candidates.py`
- `20260413_0006_segment_global_fallback_candidates.py`
- `20260413_0007_drop_recommendation_outbox.py`
- `20260413_0008_add_graph_event_journal_and_pair_features.py`
- `20260414_0009_drop_precomputed_snapshots.py`

## Environment Variables

Core:

- `INTERNAL_SERVICE_KEY`
- `HOST`
- `PORT`
- `RELOAD`
- `DATABASE_URL`

Model:

- `RECOMMENDATION_MODEL_NAME`
- `RECOMMENDATION_MAX_LENGTH`
- `RECOMMENDATION_BATCH_SIZE`
- `RECOMMENDATION_MAX_CANDIDATES`
- `RECOMMENDATION_QUERY_INSTRUCTION`
- `RECOMMENDATION_SCORE_FLOOR`
- `RECOMMENDATION_SCORE_CEILING`

Pipeline:

- `RECOMMENDATION_QUERY_RERANK_TOP_K`
- `RECOMMENDATION_QUERY_CACHE_TTL_SECONDS`
- `RECOMMENDATION_QUERY_CACHE_MAX_ENTRIES`
- `RECOMMENDATION_QUERY_CACHE_REDIS_HOST`
- `RECOMMENDATION_QUERY_CACHE_REDIS_PORT`
- `RECOMMENDATION_QUERY_CACHE_REDIS_DB`
- `RECOMMENDATION_QUERY_CACHE_REDIS_PREFIX`
- `RECOMMENDATION_QUERY_MODEL_WEIGHT`
- `RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT`
- `RECOMMENDATION_QUERY_GRAPH_WEIGHT`
- `RECOMMENDATION_MUTUAL_FRIEND_CAP`
- `RECOMMENDATION_COMMON_GROUP_CAP`
- `RECOMMENDATION_GLOBAL_FALLBACK_TOP_K`
- `RECOMMENDATION_GLOBAL_FALLBACK_REFRESH_INTERVAL_SECONDS`

Messaging:

- `KAFKA_BROKERS`
- `KAFKA_CLIENT_ID`
- `KAFKA_GROUP_ID`
- `KAFKA_TOPIC_INIT_RETRIES`
- `KAFKA_TOPIC_INIT_RETRY_DELAY_SECONDS`
- `KAFKA_TOPIC_INIT_WAIT_TIMEOUT_SECONDS`
- `RECOMMENDATION_PROFILE_TOPIC`
- `RECOMMENDATION_GRAPH_TOPIC`
- `RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS`

## Dev Commands

- `npm run install`
- `npm run model:warmup`
- `npm run db:upgrade`
- `npm run start:dev`
- `npm run test`
- `npm run lint`
- `npm run format`

## Operational Notes

- Service warms model at startup to avoid first-request latency spikes.
- Query pipeline is deterministic and score-versioned for easier rollout tracking.
- Fallback materialization is segment-aware (`locale::language`) for future targeting.
