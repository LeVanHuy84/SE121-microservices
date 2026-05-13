# notification-service

The notification service owns notification delivery, user preferences, device tokens, and chat push fan-out. It listens on TCP for query and update commands and on RabbitMQ for delivery jobs and push-related events, while persisting state in MongoDB and caching hot preference data in Redis.

## Responsibilities

- Create, queue, and deliver user notifications.
- Maintain per-user notification preferences and rate limits.
- Register and manage device tokens for push delivery.
- Process RabbitMQ events for notification creation and chat push actions.
- Publish delivery work into Bull and Firebase-backed push flows.

## Runtime Profile

| Item            | Value                        |
| --------------- | ---------------------------- |
| Service type    | NestJS                       |
| Port(s)         | `PORT` or `4007` for TCP     |
| Transport(s)    | TCP, RabbitMQ, Redis         |
| Primary storage | MongoDB                      |
| Shared packages | `@repo/common`, `@repo/dtos` |

## Interfaces

### HTTP API

- No HTTP API was verified in this service.

### TCP / RPC

- Notification RPC patterns: `get_notifications`, `mark_read`, `mark_read_all`, `delete_notification`, and `delete_all_notifications`.
- Device token RPC patterns: `register_device_token`, `remove_device_token`, `get_user_tokens`, and `remove_all_user_tokens`.

### Events

- RabbitMQ event handlers: `create_notification`, `send_chat_push`, and `clear_chat_push_state`.
- The notification controller acknowledges or rejects RMQ messages explicitly after processing.

### Async Infrastructure

- Bull queue name: `NOTIFICATION_QUEUE`.
- Queue job used by the service layer: `REGULAR_NOTIFICATION_DELIVERY_JOB`.
- Redis caches user preference documents, notification pages, and chat push state.

## Internal Flow

- Notification creation starts from a RabbitMQ event, then the service renders a template, checks the recipient’s preferences, and enqueues delivery work.
- If the user has no allowed channels or hits a rate limit, the service still stores a notification record with suppression metadata.
- Chat push work uses Redis, Bull, and Firebase Admin to fan out notifications to active tokens.
- RPC reads and mutations operate on the MongoDB notification store and the device-token store.

## Dependencies

- MongoDB via `MONGODB_URI`.
- Redis via `REDIS_HOST` and `REDIS_PORT`.
- RabbitMQ via `RABBITMQ_USER`, `RABBITMQ_PASS`, `RABBITMQ_HOST`, `RABBITMQ_PORT`, and `RABBITMQ_QUEUE`.
- Firebase Admin for push delivery.
- Bull for deferred delivery jobs.
- Shared DTOs for notification and device-token payloads.

## Health and Readiness

- No dedicated health or readiness endpoint is implemented in the service code.

## Observability

- Uses the shared `ExceptionsFilter` for the TCP and RabbitMQ microservice instances.
- Logs queueing, rate-limit, and delivery decisions through Nest `Logger` calls.
- RabbitMQ acknowledgements and negative acknowledgements are handled explicitly in the controller.
- No metrics or tracing exporter was verified.

## Environment Variables

| Variable                      | Purpose                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `PORT`                        | TCP listener port, defaults to `4007`.                   |
| `MONGODB_URI`                 | MongoDB connection string.                               |
| `REDIS_HOST`                  | Redis host for preference and notification caches.       |
| `REDIS_PORT`                  | Redis port, defaults to `6379`.                          |
| `RABBITMQ_USER`               | RabbitMQ username, defaults to `guest`.                  |
| `RABBITMQ_PASS`               | RabbitMQ password, defaults to `guest`.                  |
| `RABBITMQ_HOST`               | RabbitMQ host, defaults to `localhost`.                  |
| `RABBITMQ_PORT`               | RabbitMQ port, defaults to `5672`.                       |
| `RABBITMQ_QUEUE`              | RMQ queue name, defaults to `create_notification_queue`. |
| `CHAT_PUSH_STATE_TTL_SECONDS` | TTL for chat push state stored in Redis.                 |
| `NATIVE_ANDROID_APP_ID`       | Default Android app id used in push payloads.            |

## Development

```bash
npm install
npm run start:dev
npm run build
npm run test
npm run test:unit
npm run test:e2e
npm run lint
```

## Docker and Deployment

- No service-specific Dockerfile was found in the repository scan.
- The service expects the root Compose stack to provide MongoDB, Redis, RabbitMQ, and supporting infra.

## Scaling Considerations

- Bull and RabbitMQ let notification delivery scale separately from API reads.
- Redis preference caching reduces repeated MongoDB lookups.
- Device-token queries are MongoDB-backed and benefit from careful token lifecycle cleanup.

## Troubleshooting

- If delivery jobs are not queued, verify RabbitMQ connectivity and the queue name.
- If push delivery fails, verify Firebase Admin credentials and active device tokens.
- If rate limiting seems wrong, inspect the Redis counters used by `UserPreferenceService`.
- If Mongo reads fail, confirm `MONGODB_URI` and the service account service names in the Compose stack.
