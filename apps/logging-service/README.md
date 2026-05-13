# logging-service

The logging service is the repository’s log sink for audit records and user activity events. It consumes Kafka events, stores normalized records in MongoDB, and exposes RPC queries back to the rest of the platform.

## Responsibilities

- Consume audit and user-activity events from Kafka.
- Persist log records into MongoDB collections.
- Serve log lookup queries over the TCP microservice transport.
- Keep the log store isolated from the rest of the application services.

## Runtime Profile

| Item            | Value                                |
| --------------- | ------------------------------------ |
| Service type    | NestJS                               |
| Port(s)         | `PORT` or `4012` for TCP             |
| Transport(s)    | HTTP, TCP, Kafka                     |
| Primary storage | MongoDB (`logging_service` database) |
| Shared packages | `@repo/common`, `@repo/dtos`         |

## Interfaces

### HTTP API

- `GET /` is implemented by `AppController` and returns the app service greeting.
- No health-specific HTTP route was verified.

### TCP / RPC

- `get_audit_log` returns audit-log queries.
- `get_user_activity_log` returns user-activity queries and expects an `actorId` in the request payload.

### Events

- Kafka consumer topics: `EventTopic.LOGGING` and `EventTopic.USER_ACTIVITY_LOG`.
- The consumer uses `KafkaConsumerHelper` for idempotent handling and wraps the database writes in a Mongo session.

### Async Infrastructure

- MongoDB collections: `audit_logs` and `user_activity_logs`.
- The Kafka consumer is isolated from the query path so write ingestion and reads can scale separately.

## Internal Flow

- Kafka events arrive in `ConsumerController` and are handled through `ConsumerService` inside a Mongo transaction/session.
- RPC queries in `LogController` read the persisted records back out of the database.
- The service module wiring keeps the HTTP greeting path separate from the microservice and consumer paths.

## Dependencies

- MongoDB via `MONGODB_URI`.
- Kafka brokers, client id, and group id.
- Shared DTOs for `AuditLogQuery`, `GetUserActivityLogQuery`, `LogEvent`, and `UserActivityLogEvent`.
- Shared `KafkaConsumerHelper` and `ExceptionsFilter` from the common package.

## Health and Readiness

- No dedicated health or readiness endpoint is implemented.
- The only verified HTTP route is `GET /`.

## Observability

- Uses Nest `Logger` in the Kafka consumer for processed-event logs.
- The consumer helper provides idempotent topic/event handling.
- No metrics or tracing exporter was verified.

## Environment Variables

| Variable          | Purpose                                |
| ----------------- | -------------------------------------- |
| `PORT`            | TCP listener port, defaults to `4012`. |
| `MONGODB_URI`     | MongoDB connection string.             |
| `KAFKA_BROKERS`   | Kafka broker list.                     |
| `KAFKA_CLIENT_ID` | Kafka client id.                       |
| `KAFKA_GROUP_ID`  | Kafka consumer group id.               |

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
- The service depends on the root Compose stack for MongoDB and Kafka locally.

## Scaling Considerations

- Kafka consumer groups can scale independently from the TCP query path.
- MongoDB collections should keep the audit and activity indexes tight as event volume grows.
- The idempotent consumer helper helps the service tolerate duplicate Kafka delivery.

## Troubleshooting

- If Kafka ingestion stalls, verify `KAFKA_BROKERS`, `KAFKA_CLIENT_ID`, and `KAFKA_GROUP_ID`.
- If log queries fail, verify `MONGODB_URI` and the `logging_service` database.
- If `GET /` works but RPC does not, confirm the TCP port and transport listener are both running.
