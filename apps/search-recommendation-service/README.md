# search-recommendation-service

## Overview
Discovery and personalization engine for Sentimeta. Powers full-text multi-entity search across users, posts, and groups via Elasticsearch, semantic profile recommendations using pgvector Approximate Nearest Neighbor (HNSW ANN) indexing on PostgreSQL, and mood-adaptive music recommendations mapped to user valence/arousal emotional states.

## Interface
- **TCP Microservice Patterns** (Listening on TCP port `4003`):
  - `search.query`: Multi-index search across users, groups, and posts.
  - `search.users`: Dedicated fuzzy search for users.
  - `search.posts`: Full-text post search with relevance scoring.
  - `recommendation.users`: Generates friend and interest recommendations via pgvector vector embeddings.
  - `recommendation.groups`: Suggests relevant community groups.
  - `music.recommend_by_emotion`: Returns mood-aligned music tracks based on valence and arousal scores.
  - `music.catalog.list`: Retrieves browsable music tracks and playlist categories.
- **Kafka Consumers**: Ingests entity change feeds from `user-social-service` and `content-feed-service` to synchronize search indexes asynchronously.
- **Shared Dependencies**: `[common](../../packages/common/README.md)` and `[dtos](../../packages/dtos/README.md)`.

## Invariants
- Elasticsearch index documents must stay eventually consistent with source databases via Kafka consumer reconciliation.
- Vector similarity operations require 768-dimensional normalized embeddings indexed via HNSW.
- Emotion-to-music mapping maps emotional vectors to musical valence-energy quadrants.

## Side Effects
- Indexes and updates documents in Elasticsearch (`users`, `posts`, `groups` indexes).
- Reads and updates vector embeddings in PostgreSQL (`pgvector` extension).
- Caches frequent search query results and recommendation candidate sets in Redis.

## Verification
- Run: `npm test` (`jest --passWithNoTests`)

---

## Responsibilities & Operational Details

### Responsibilities

- **Elasticsearch Indexing**: Index posts, users, and groups, and perform fast full-text searching.
- **Semantic Recommendations**: Query similar profiles using pgvector HNSW ANN (Approximate Nearest Neighbors) search based on profile embeddings.
- **Music Recommendations**: Catalog music track valence/arousal attributes, matching them dynamically to user emotional state metrics.

### Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4003` (TCP) |
| Transports | TCP, Kafka, Redis |
| Primary storage | Elasticsearch, PostgreSQL (pgvector) |
| Cache / Buffer | Redis |
| Shared packages | `@repo/common`, `@repo/dtos` |

### Key Modules

- **Search**: Elasticsearch clients, sync consumer for `POST`, `USER`, and `GROUP` topics, batch flush scheduling.
- **Recommendation**: pgvector similarity scorer, candidate generator, and caching.
- **Music**: Music catalog, emotion affinity tracks map.

### Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP listener port | `4003` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `ES_NODE` | Elasticsearch endpoint | `http://localhost:9200` |
| `REDIS_HOST` | Redis host for query caching | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |

### Development

```bash
npm install
npm run start:dev
npm run build
```
