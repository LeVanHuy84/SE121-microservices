# search-recommendation-service

The search-recommendation-service is the discovery and personalization backend. It indexes entities in Elasticsearch, runs pgvector semantic matching, and provides emotion-aware music recommendations.

## Responsibilities

- **Elasticsearch Indexing**: Index posts, users, and groups, and perform fast full-text searching.
- **Semantic Recommendations**: Query similar profiles using pgvector HNSW ANN (Approximate Nearest Neighbors) search based on profile embeddings.
- **Music Recommendations**: Catalog music track valence/arousal attributes, matching them dynamically to user emotional state metrics.

## Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4003` (TCP) |
| Transports | TCP, Kafka, Redis |
| Primary storage | Elasticsearch, PostgreSQL (pgvector) |
| Cache / Buffer | Redis |
| Shared packages | `@repo/common`, `@repo/dtos` |

## Key Modules

- **Search**: Elasticsearch clients, sync consumer for `POST`, `USER`, and `GROUP` topics, batch flush scheduling.
- **Recommendation**: pgvector similarity scorer, candidate generator, and caching.
- **Music**: Music catalog, emotion affinity tracks map.

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP listener port | `4003` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `ES_NODE` | Elasticsearch endpoint | `http://localhost:9200` |
| `REDIS_HOST` | Redis host for query caching | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |

## Development

```bash
npm install
npm run start:dev
npm run build
```
