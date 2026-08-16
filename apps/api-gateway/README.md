# api-gateway

The API gateway is the external entry point for the monorepo. It serves HTTP routes, hosts the Socket.IO chat namespace, verifies Clerk webhooks, and proxies requests out to the 6 downstream services.

## Responsibilities

- Terminate public HTTP traffic under a single global prefix `/api/v1`.
- Apply Clerk-based authentication and webhook verification.
- Proxy domain requests to downstream services (TCP client proxies for NestJS, HTTP client for Python AI).
- Host the realtime chat namespace and presence broadcast layer.
- Share Redis-backed Socket.IO state across gateway instances.

## Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `GATEWAY_PORT` or `4000` |
| Transports | HTTP, WebSocket, Redis, RabbitMQ |
| Primary storage | None |
| Shared packages | `@repo/common`, `@repo/dtos` |

## Downstream Services Proxied

- **user-social-service** (TCP 4001) for profiles, relationships, and groups.
- **content-feed-service** (TCP 4002) for posts, comments, reactions, feeds, media, notifications, and logging.
- **search-recommendation-service** (TCP 4003) for search and recommendations.
- **chat-service** (TCP 4004) for chat messages, presence, and calls.
- **emotion-intelligence-service** (TCP 4005) for emotion analytics & dashboard profiles.
- **ai-chatbot-service** (HTTP 4006) for AI chatbot responses & feedback.

## Environment Variables

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

## Development

```bash
npm install
npm run start:dev
npm run build
npm run lint
```
