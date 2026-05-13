# api-gateway

The API gateway is the external entry point for the monorepo. It serves HTTP routes, hosts the Socket.IO chat namespace, verifies Clerk webhooks, and fans requests out to downstream services without owning domain data itself.

## Responsibilities

- Terminate public HTTP traffic under a single global prefix.
- Apply Clerk-based authentication and webhook verification.
- Proxy domain requests to downstream services through client modules.
- Host the realtime chat namespace and presence broadcast layer.
- Share Redis-backed Socket.IO state across gateway instances.
- Expose the gateway surface without persisting domain data locally.

## Runtime Profile

| Item            | Value                            |
| --------------- | -------------------------------- |
| Service type    | NestJS                           |
| Port(s)         | `GATEWAY_PORT` or `4000`         |
| Transport(s)    | HTTP, WebSocket, Redis, RabbitMQ |
| Primary storage | None                             |
| Shared packages | `@repo/common`, `@repo/dtos`     |

## Interfaces

### HTTP API

- Global prefix: `/api/v1`.
- Route groups verified in code: `/users`, `/users/admin`, `/posts`, `/comments`, `/reactions`, `/shares`, `/feeds`, `/social`, `/groups`, `/group-reports`, `/notifications`, `/logs`, `/search`, `/assistant`, `/media`, `/emotions`, `/admin`, `/admin/emotion`, `/webhooks/clerk`, and `/musics`.
- The gateway layer delegates to downstream services rather than owning the business logic locally.

### WebSocket

- Namespace: `/chat`.
- Client events: `heartbeat`, `presence.subscribe`, `presence.unsubscribe`, `conversation.join`, `conversation.leave`, `typing.start`, `typing.stop`.
- Server events: `presence.snapshot`, `presence.update`, `message.new`, `message.updated`, `message.deleted`, `typing`, `conversation.error`.

### Integration Points

- Clerk webhook ingestion at `/webhooks/clerk` using Svix signatures.
- Redis-backed Socket.IO adapter and presence/pub-sub channels.
- RabbitMQ exchanges registered in the app module: `notification` and `broadcast`.
- Chat event fan-out from the Redis stream `chat:events` into the WebSocket layer.

## Internal Flow

- HTTP requests enter `src/main.ts`, receive CORS, the gateway exception filter, and the date-format interceptor, then are routed to the feature controllers.
- WebSocket clients connect to `/chat`, pass Clerk middleware, join per-user and per-conversation rooms, and receive chat stream updates from the Redis consumer.
- Clerk webhooks are verified in `webhooks/clerk` before the relevant user lifecycle handler is called.

## Dependencies

- Clerk secret keys and webhook secret.
- Redis for Socket.IO adapter state, presence, and chat event consumption.
- RabbitMQ for gateway-level messaging integration.
- Downstream service clients, especially the chat service client and feature modules wired in `AppModule`.

## Health and Readiness

- No dedicated health or readiness endpoint is implemented in this service.

## Observability

- Uses `GatewayExceptionsFilter` for request and socket error handling.
- Applies `DateFormatInterceptor` to normalize date serialization.
- Emits runtime logs through NestJS `Logger` in the WebSocket and webhook flow.
- No metrics or tracing exporters were verified in the service code.

## Environment Variables

| Variable                               | Purpose                                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| `GATEWAY_PORT`                         | HTTP listener port, defaults to `4000`.                       |
| `REDIS_HOST`                           | Redis host for the Socket.IO adapter and chat/presence flows. |
| `REDIS_PORT`                           | Redis port, defaults to `6379`.                               |
| `CLERK_SECRET_KEY`                     | Clerk middleware secret for WebSocket auth.                   |
| `CLERK_WEBHOOK_SECRET`                 | Svix webhook secret for Clerk webhook verification.           |
| `GATEWAY_INSTANCE_ID`                  | Stable instance identity for presence and stream consumers.   |
| `HOSTNAME`                             | Fallback instance identity.                                   |
| `PRESENCE_HEARTBEAT_MIN_INTERVAL_MS`   | Minimum heartbeat interval for presence updates.              |
| `CHAT_ACTIVE_CONVERSATION_TTL_SECONDS` | TTL for active conversation tracking in Redis.                |
| `CHAT_STREAM_BATCH_SIZE`               | Batch size for Redis stream reads.                            |
| `CHAT_STREAM_BLOCK_MS`                 | Blocking wait time for Redis stream reads.                    |
| `CHAT_STREAM_CLAIM_IDLE_MS`            | Idle time before claiming stale stream entries.               |
| `CHAT_STREAM_CLAIM_INTERVAL_MS`        | Claim loop interval for stale stream entries.                 |
| `CHAT_STREAM_MAX_RETRIES`              | Retry cap for chat stream processing.                         |
| `CHAT_STREAM_DLQ_MAXLEN`               | Dead-letter stream length cap.                                |
| `CHAT_CONV_VERSION_TTL_SEC`            | Conversation version TTL in Redis.                            |
| `CHAT_MSG_VERSION_TTL_SEC`             | Message version TTL in Redis.                                 |

## Development

```bash
npm install
npm run start:dev
npm run build
npm run test
npm run test:e2e
npm run lint
```

## Docker and Deployment

- No service-specific Dockerfile was found in the repository scan.
- The service depends on the root Docker Compose stack for Redis and RabbitMQ during local development.

## Scaling Considerations

- WebSocket scaling depends on the shared Redis adapter and stable instance identity.
- Presence and chat stream processing are tuned with batch, block, claim, and retry environment variables.
- The gateway remains stateless; any scale-out state lives in Redis or downstream services.

## Troubleshooting

- If WebSocket auth fails, verify `CLERK_SECRET_KEY` and the Clerk middleware path.
- If Clerk webhooks are rejected, verify `CLERK_WEBHOOK_SECRET` and Svix headers.
- If chat events stop flowing, check Redis stream group creation and the gateway consumer settings.
- If realtime presence is stale, confirm Redis connectivity and the heartbeat interval settings.
