# content-feed-service

## Overview
Core content publishing, social engagement, and personalized feed generation engine for Sentimeta. Manages post lifecycles, comments, multi-type reactions, shares, personalized newsfeed ranking using Redis sorted sets (ZSET), media metadata verification with Cloudinary, notification fan-out via RabbitMQ, and central administrative audit logging.

## Interface
- **TCP Microservice Patterns** (Listening on TCP port `4002`):
  - `post.create`, `post.update`, `post.delete`, `post.find_by_id`: Post CRUD operations.
  - `comment.create`, `comment.list`, `comment.delete`: Threaded post comments.
  - `reaction.toggle`, `reaction.count`: Like/love/reaction management.
  - `feed.get_personal_feed`: Returns ranked personalized newsfeed for authenticated users.
  - `feed.get_trending_feed`: Returns globally trending posts based on engagement velocity.
  - `media.upload_signature`, `media.verify`: Cloudinary upload token generation and asset validation.
  - `notification.send`, `notification.list`: Dispatches and retrieves user notification records.
  - `log.ingest`: Ingests operational and security audit logs.
- **Shared Dependencies**: `[common](../../packages/common/README.md)` and `[dtos](../../packages/dtos/README.md)`.

## Invariants
- Deleted posts cascade soft-deletion to associated comments and reactions.
- Feed rank score combines recency decay, user affinity, comment/reaction velocity, and baseline emotional valence.
- Uploaded media assets must be validated against Cloudinary signatures before public exposure.
- Notifications are published reliably via RabbitMQ topic exchanges.

## Side Effects
- Mutates posts, comments, reactions, media records, and audit logs in MongoDB.
- Maintains and ranks personalized user feed buffers in Redis Sorted Sets (`feed:{userId}`).
- Publishes content events (`post-created`, `post-reacted`) to Apache Kafka for emotion analysis and recommendations.
- Emits notification delivery jobs to RabbitMQ queues (`notification-queue`).

## Verification
- Run: `npm test` (`jest --passWithNoTests`)

---

## Responsibilities & Operational Details

### Responsibilities

- **Post Lifecycle**: Create, edit, delete, react to, and comment on posts.
- **Feed Personalization**: Score and rank feeds using a multi-factor algorithm (recency, engagement, and emotional alignment baseline).
- **Media Management**: Secure media uploads via Cloudinary and clean up orphaned uploads.
- **Notifications**: Fan out notification events to RabbitMQ queues (push, email, SMS).
- **Logging Ingestion**: Handle structured audit/admin logs.

### Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4002` (TCP) |
| Transports | TCP, Kafka, RabbitMQ, Redis |
| Primary storage | MongoDB (Mongoose) |
| Cache / Buffer | Redis |
| Shared packages | `@repo/common`, `@repo/dtos` |

### Key Modules

- **Post**: Operations for posts, comments, reactions, and shares.
- **Feed**: Personalized ranking ZSET buffers.
- **Media**: Cloudinary webhook handlers and upload metadata tracking.
- **Notification**: RabbitMQ publishers for notifications.
- **Logging**: central service auditing.

### Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP listener port | `4002` |
| `MONGODB_URI` | MongoDB connection string | — |
| `REDIS_HOST` | Redis host for feeds and caching | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |
| `CLOUDINARY_URL` | Cloudinary integration endpoint | — |
| `RABBITMQ_URL` | RabbitMQ queue broker URI | `amqp://guest:guest@localhost:5672` |

### Development

```bash
npm install
npm run start:dev
npm run build
```
