# @repo/common

## Overview
Shared infrastructure utilities, middleware, filters, and message broker abstractions for NestJS microservices across the SE121 backend ecosystem.

## Interface
- **Filters** (`./src/filters`): `RpcExceptionFilter` for transforming microservice RPC errors into uniform HTTP error responses.
- **Redis Module** (`./src/redis`): `RedisModule`, `RedisService` providing distributed key-value caching, session tracking, and rate limiting helpers.
- **Kafka Module** (`./src/kafka`, `./src/kafka-producer`): `KafkaModule`, `KafkaService`, `KafkaProducer` for decoupled event publishing and message consumption.
- **RabbitMQ Module** (`./src/rabbimq`): `RabbitMQModule` supporting AMQP task queue orchestration.
- **Events & Notifications** (`./src/event`, `./src/notification`): Standardized microservice domain events and notification dispatchers.
- **Observability** (`./src/observability/otel`): OpenTelemetry tracing and metrics instrumentation wrappers.

## Invariants
- `RpcExceptionFilter` must catch unhandled microservice exceptions and map them to standard NestJS `HttpException` formats.
- Kafka producer instances must handle broker reconnects with backoff retry logic.
- Redis connection pools must be shared through dependency injection via `RedisModule`.

## Side Effects
- Connects to external Redis clusters for cache reads/writes.
- Publishes and consumes messages from Apache Kafka and RabbitMQ message brokers.
- Emits distributed OpenTelemetry traces across service network calls.

## Verification
- Run: `npm run check-types`
