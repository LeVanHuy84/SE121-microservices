# content-feed-service

The content-feed-service is the core content publisher and personalization processor. It controls post creation, engagement metrics (likes, reactions, comments), personalized feed ranking, image/video uploads, notification queues, and administrative logs.

## Responsibilities

- **Post Lifecycle**: Create, edit, delete, react to, and comment on posts.
- **Feed Personalization**: Score and rank feeds using a multi-factor algorithm (recency, engagement, and emotional alignment baseline).
- **Media Management**: Secure media uploads via Cloudinary and clean up orphaned uploads.
- **Notifications**: Fan out notification events to RabbitMQ queues (push, email, SMS).
- **Logging Ingestion**: Handle structured audit/admin logs.

## Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4002` (TCP) |
| Transports | TCP, Kafka, RabbitMQ, Redis |
| Primary storage | MongoDB (Mongoose) |
| Cache / Buffer | Redis |
| Shared packages | `@repo/common`, `@repo/dtos` |

## Key Modules

- **Post**: Operations for posts, comments, reactions, and shares.
- **Feed**: Personalized ranking ZSET buffers.
- **Media**: Cloudinary webhook handlers and upload metadata tracking.
- **Notification**: RabbitMQ publishers for notifications.
- **Logging**: central service auditing.

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP listener port | `4002` |
| `MONGODB_URI` | MongoDB connection string | — |
| `REDIS_HOST` | Redis host for feeds and caching | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |
| `CLOUDINARY_URL` | Cloudinary integration endpoint | — |
| `RABBITMQ_URL` | RabbitMQ queue broker URI | `amqp://guest:guest@localhost:5672` |

## Development

```bash
npm install
npm run start:dev
npm run build
```
