# chat-service

## Overview
NestJS microservice responsible for private 1-on-1 conversations, group chats, message history, user presence tracking, audio/video calling tokens, and transactional outbox event delivery within the Sentimeta platform.

## Interface
- **TCP Microservice Patterns** (Listening on TCP port `4004` via `@TcpMessagePattern`):
  - `chat.conversation.create`: Initializes a 1-on-1 or group conversation.
  - `chat.conversation.find_by_user`: Retrieves paginated conversations for a user.
  - `chat.message.send`: Persists and broadcasts a message within a conversation.
  - `chat.message.list`: Retrieves historical messages with cursor pagination.
  - `chat.presence.update`: Updates online/offline and last-seen timestamps in Redis.
  - `chat.call.create_token`: Generates Stream Video/Audio calling session credentials.
- **Shared Dependencies**: `[common](../../packages/common/README.md)` and `[dtos](../../packages/dtos/README.md)`.

## Invariants
- Messages and conversations are stored transactionally in MongoDB with an outbox record to guarantee at-least-once message delivery to Kafka.
- Presence heartbeats must maintain Redis keys with TTLs to prevent ghost active sessions.
- Users can only read or post to conversations in which they are valid active participants.

## Side Effects
- Reads and persists conversation, message, and outbox documents in MongoDB.
- Manages user presence keys and publishes real-time message notifications via Redis Streams.
- Emits message lifecycle events to Apache Kafka (`chat-events` topic).
- Calls GetStream API to mint token credentials for audio/video call sessions.

## Verification
- Run: `npm test` (`jest --passWithNoTests`)

---

## Responsibilities & Operational Details

### Responsibilities

- **Chat Messaging**: Manage conversation and message lifecycle.
- **Realtime Coordination**: Publish instant updates through a Redis stream consumed by the gateway.
- **Presence**: Track online/offline status in Redis.
- **Transactional Outbox**: Guarantee outbox-backed delivery of message and conversation events to Kafka.

### Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4004` (TCP) |
| Transports | TCP, Redis, Kafka |
| Primary storage | MongoDB (Mongoose) |
| Cache / Buffer | Redis |
| Shared packages | `@repo/common`, `@repo/dtos` |

### Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP listener port | `4004` |
| `MONGODB_URI` | MongoDB connection string | — |
| `REDIS_HOST` | Redis host for presence and streams | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |
| `STREAM_API_KEY` | Stream API key for video calls | — |
| `STREAM_API_SECRET`| Stream API secret for video calls | — |

### Development

```bash
npm install
npm run start:dev
npm run build
```
