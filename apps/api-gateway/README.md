# api-gateway

## Overview
The API Gateway is the external ingress point and reverse proxy for the Sentimeta backend platform. It terminates public HTTP traffic under `/api/v1`, hosts the Socket.IO real-time chat and presence namespace, verifies Clerk authentication and Svix webhooks, and proxies domain requests out to downstream microservices via NestJS TCP transports and HTTP clients.

## Interface
- **Public HTTP API Routes** (`/api/v1`):
  - `/api/v1/users`, `/api/v1/friends`, `/api/v1/groups`: Proxies to `user-social-service` (TCP 4001)
  - `/api/v1/posts`, `/api/v1/comments`, `/api/v1/reactions`, `/api/v1/feeds`, `/api/v1/media`, `/api/v1/notifications`: Proxies to `content-feed-service` (TCP 4002)
  - `/api/v1/search`, `/api/v1/recommendations`, `/api/v1/music`: Proxies to `search-recommendation-service` (TCP 4003)
  - `/api/v1/chat`, `/api/v1/conversations`, `/api/v1/calls`: Proxies to `chat-service` (TCP 4004)
  - `/api/v1/emotions`, `/api/v1/moderation`: Proxies to `emotion-intelligence-service` (TCP 4005)
  - `/api/v1/chatbot`: Proxies to `ai-chatbot-service` (HTTP 4006)
  - `/api/v1/webhooks/clerk`: Svix webhook endpoint for Clerk user lifecycle synchronization
- **WebSocket Gateway** (`/chat`, `/presence`): Realtime Socket.IO gateway for messaging, typing indicators, active call signaling, and user presence broadcasts.
- **Shared Dependencies**: `[common](../../packages/common/README.md)` and `[dtos](../../packages/dtos/README.md)`.

## Invariants
- All incoming requests must undergo Clerk JWT authentication verification, excluding explicit public routes (e.g. webhooks, public health checks).
- Microservice proxy errors must be caught by `RpcExceptionFilter` and translated to standard HTTP error envelopes.
- Real-time Socket.IO adapter must use Redis for multi-instance socket synchronization.
- Clerk webhook signatures must be verified via Svix using `CLERK_WEBHOOK_SECRET` before processing.

## Side Effects
- Proxies requests across network boundaries via TCP microservice clients and HTTP clients.
- Reads and updates Redis pub/sub channels and cache keys for user presence and socket sessions.
- Emits real-time WebSocket events to connected browser and mobile clients.

## Verification
- Run: `npm test` (`jest --passWithNoTests`)

---

## Architecture & Operational Details

### Responsibilities

- Terminate public HTTP traffic under a single global prefix `/api/v1`.
- Apply Clerk-based authentication and webhook verification.
- Proxy domain requests to downstream services (TCP client proxies for NestJS, HTTP client for Python AI).
- Host the realtime chat namespace and presence broadcast layer.
- Share Redis-backed Socket.IO state across gateway instances.

### Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `GATEWAY_PORT` or `4000` |
| Transports | HTTP, WebSocket, Redis, RabbitMQ |
| Primary storage | None |
| Shared packages | `@repo/common`, `@repo/dtos` |

### Downstream Services Proxied

- **user-social-service** (TCP 4001) for profiles, relationships, and groups.
- **content-feed-service** (TCP 4002) for posts, comments, reactions, feeds, media, notifications, and logging.
- **search-recommendation-service** (TCP 4003) for search and recommendations.
- **chat-service** (TCP 4004) for chat messages, presence, and calls.
- **emotion-intelligence-service** (TCP 4005) for emotion analytics & dashboard profiles.
- **ai-chatbot-service** (HTTP 4006) for AI chatbot responses & feedback.

### Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `GATEWAY_PORT` | HTTP listener port | `4000` |
| `USER_SOCIAL_SERVICE_PORT` | Port for user-social-service | `4001` |
| `CONTENT_FEED_SERVICE_PORT` | Port for content-feed-service | `4002` |
| `SEARCH_RECOMMENDATION_SERVICE_PORT` | Port for search-recommendation-service | `4003` |
| `CHAT_SERVICE_PORT` | Port for chat-service | `4004` |
| `EMOTION_INTELLIGENCE_SERVICE_PORT` | Port for emotion-intelligence-service | `4005` |
| `AI_CHATBOT_SERVICE_URL` | Endpoint for python ai-chatbot-service | `http://localhost:4006` |
| `REDIS_HOST` | Redis host for Socket.IO state | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `CLERK_SECRET_KEY` | Clerk middleware secret key | — |
| `CLERK_WEBHOOK_SECRET` | Svix webhook secret for Clerk webhook verification | — |

### Development

```bash
npm install
npm run start:dev
npm run build
npm run lint
```
