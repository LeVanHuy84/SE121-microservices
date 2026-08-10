# user-service

The user service owns user profile data, system-user administration, and user-facing RPC handlers. It persists profile state in PostgreSQL through Drizzle, uses Redis for cache and transport support, and emits outbound events through the outbox pattern.

## Responsibilities

- Create, update, query, and remove user records.
- Serve admin/system-user workflows and profile recommendation candidate queries.
- Resolve user relationships through the social service when the caller asks for a profile with relation context.
- Maintain the outbox records that forward user, logging, and recommendation-profile events.
- Bootstrap the system admin account from Clerk credentials on startup.

## Runtime Profile

| Item            | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| Service type    | NestJS                                                       |
| Port(s)         | `PORT` or `4001` for TCP; Redis transport is bound to `6379` |
| Transport(s)    | TCP, Redis, Kafka                                            |
| Primary storage | PostgreSQL                                                   |
| Shared packages | `@repo/common`, `@repo/dtos`                                 |

## Interfaces

### HTTP API

- No HTTP routes are exposed by this service.

### TCP / RPC

- Public message patterns from `UserController`: `createUser`, `findAllUser`, `findOneUser`, `updateUser`, `removeUser`, `getUsersBatch`, `getBaseUsersBatch`, and `getProfileRecommendationCandidates`.
- Admin message patterns from `admin.controller.ts`: `create-system-user`, `update-system-user-role`, `get-system-users`, `ban-user`, `unban-user`, and `user-dashboard`.
- `findOneUser` calls the social-service client pattern `get_relationship_status` to enrich the profile response.

### Events

- Outbox records are written for Kafka and RabbitMQ destinations, depending on the event path.
- Verified outbox topics: `EventTopic.USER`, `EventTopic.LOGGING`, and `EventTopic.RECOMMENDATION_PROFILE`.
- The recommendation profile flow emits `RecommendationProfileEventType.EMBEDDING_REQUESTED`.

### Async Infrastructure

- Redis is used for cache keys such as `user:{id}` and `users:all`.
- A scheduled outbox processor runs every 5 seconds and forwards queued events to Kafka or RabbitMQ.

## Internal Flow

- RPC requests enter `UserController`, which delegates to `UserService` or `AdminService`.
- Reads are cached in Redis and invalidated when the underlying profile changes.
- Writes append outbox rows through `OutboxService`; the scheduled processor publishes them by destination.
- The startup command path creates a `CommandService` context and ensures the root admin exists in Clerk and the database.

## Dependencies

- PostgreSQL via `DATABASE_URL`.
- Redis via `REDIS_HOST` and `REDIS_PORT`.
- Kafka producer configuration for the outbox flow.
- RabbitMQ configuration for outbox destinations that target RMQ.
- Clerk backend client using `CLERK_SECRET_KEY`.
- Social service RPC client for relationship lookups.

## Health and Readiness

- No dedicated health or readiness endpoint is implemented in the service code.

## Observability

- Uses the shared `ExceptionsFilter` for TCP, Redis, and Kafka microservice contexts.
- Logs cache hits and outbox delivery status through Nest `Logger` calls.
- The scheduled outbox processor logs publish and retry outcomes.
- No metrics or tracing exporter was verified.

## Environment Variables

| Variable                | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `PORT`                  | TCP listener port, defaults to `4001`.                         |
| `DATABASE_URL`          | PostgreSQL connection string for Drizzle.                      |
| `REDIS_HOST`            | Redis host for cache and Redis transport support.              |
| `REDIS_PORT`            | Redis port, defaults to `6379`.                                |
| `KAFKA_BROKERS`         | Kafka broker list for the Kafka microservice and outbox.       |
| `KAFKA_CLIENT_ID`       | Kafka client id, defaults to `user-service`.                   |
| `KAFKA_GROUP_ID`        | Kafka consumer group id, defaults to `user-service-group`.     |
| `SYSTEM_ADMIN_EMAIL`    | Root admin bootstrap email.                                    |
| `SYSTEM_ADMIN_PASSWORD` | Root admin bootstrap password.                                 |
| `CLERK_SECRET_KEY`      | Clerk backend secret for admin bootstrap and auth integration. |

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
- The service expects the root Compose stack to provide PostgreSQL, Redis, and Kafka locally.

## Scaling Considerations

- Redis keeps profile reads hot and reduces pressure on PostgreSQL.
- The outbox worker is scheduled; throughput depends on database write volume and broker capacity.
- Kafka and RabbitMQ event destinations are chosen per outbox record, so downstream consumers can scale independently.

## Troubleshooting

- If startup fails, check `DATABASE_URL`, `REDIS_HOST`, and `REDIS_PORT` first.
- If the root admin bootstrap fails, verify `SYSTEM_ADMIN_EMAIL`, `SYSTEM_ADMIN_PASSWORD`, and Clerk access.
- If relationship enrichment is missing, verify the social-service RPC client wiring.
- If events do not leave the service, inspect the outbox rows and the scheduled processor logs.
