# chat-service

The chat-service handles private 1-on-1 conversations, group chats, message history, user presence tracking, audio/video calling integrations, and outbox delivery.

## Responsibilities

- **Chat Messaging**: Manage conversation and message lifecycle.
- **Realtime Coordination**: Publish instant updates through a Redis stream consumed by the gateway.
- **Presence**: Track online/offline status in Redis.
- **Transactional Outbox**: Guarantee outbox-backed delivery of message and conversation events to Kafka.

## Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4004` (TCP) |
| Transports | TCP, Redis, Kafka |
| Primary storage | MongoDB (Mongoose) |
| Cache / Buffer | Redis |
| Shared packages | `@repo/common`, `@repo/dtos` |

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP listener port | `4004` |
| `MONGODB_URI` | MongoDB connection string | — |
| `REDIS_HOST` | Redis host for presence and streams | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |
| `STREAM_API_KEY` | Stream API key for video calls | — |
| `STREAM_API_SECRET`| Stream API secret for video calls | — |

## Development

```bash
npm install
npm run start:dev
npm run build
```
