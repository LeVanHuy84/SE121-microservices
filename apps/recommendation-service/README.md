# Recommendation Service

Python/FastAPI microservice that owns friend recommendation retrieval and semantic ranking.

Current architecture is centralized in this service:

- build candidates from precomputed snapshots or online ANN retrieval (pgvector)
- apply graph projection filtering (exclude self, blocked, existing friend edges)
- rerank with semantic model scores
- apply global fallback when primary retrieval is empty or insufficient
- return cursor-based paginated result

`social-service` is now a thin orchestrator that calls `/recommend/query` and hydrates profile cards.

## Data Flow

1. User/social changes publish profile and graph events.
2. `recommendation-service` consumes events and updates projection + embeddings.
3. Processor refreshes precomputed snapshots and global fallback materialization.
4. Query pipeline serves online recommendation requests.

## Retrieval Strategy

Primary path:

- precomputed snapshot (`source=precomputed`) if fresh
- semantic online retrieval from pgvector (`source=semantic_online`) if no fresh snapshot

Fallback path:

- global fallback table (`source=global_fallback`)
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

### POST /recommend/rerank

Utility endpoint for semantic rerank/scoring over an explicit candidate set.

### POST /recommend/embed

Utility endpoint to embed profile text batches.

### GET /recommend/precomputed/{viewer_id}

Debug/inspection endpoint for current precomputed snapshot.

## Storage and Migrations

- PostgreSQL + SQLAlchemy + Alembic
- pgvector extension for vector search
- HNSW index over `profile_embeddings.embedding_vector`

Migrations:

- `20260410_0001_initial_recommendation_state.py`
- `20260413_0004_add_pgvector_profile_embeddings.py`
- `20260413_0005_add_global_fallback_candidates.py`
- `20260413_0006_segment_global_fallback_candidates.py`

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

- `RECOMMENDATION_PRECOMPUTE_TOP_K`
- `RECOMMENDATION_PRECOMPUTE_BATCH_SIZE`
- `RECOMMENDATION_PRECOMPUTED_MAX_AGE_SECONDS`
- `RECOMMENDATION_QUERY_RERANK_TOP_K`
- `RECOMMENDATION_QUERY_MODEL_WEIGHT`
- `RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT`
- `RECOMMENDATION_GLOBAL_FALLBACK_TOP_K`
- `RECOMMENDATION_GLOBAL_FALLBACK_REFRESH_INTERVAL_SECONDS`

Messaging:

- `KAFKA_BROKERS`
- `KAFKA_CLIENT_ID`
- `KAFKA_GROUP_ID`
- `RECOMMENDATION_PROFILE_TOPIC`
- `RECOMMENDATION_GRAPH_TOPIC`
- `RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS`

## Dev Commands

- `npm run install`
- `npm run db:upgrade`
- `npm run start:dev`
- `npm run test`
- `npm run lint`
- `npm run format`

## Operational Notes

- Service warms model at startup to avoid first-request latency spikes.
- Query pipeline is deterministic and score-versioned for easier rollout tracking.
- Fallback materialization is segment-aware (`locale::language`) for future targeting.
