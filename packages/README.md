# Packages

## Overview
Shared library packages, common infrastructure modules, and contract definitions consumed across all microservices and gateways in the SE121 platform.

## Subdirectories & Boundaries
- [common](./common/README.md) - Common NestJS infrastructure modules including Kafka producer, Redis caching, RabbitMQ, RPC exception filters, and OpenTelemetry observability.
- [dtos](./dtos/README.md) - Centralized Data Transfer Objects (DTOs), request/response models, and validation enums across microservices.
- [eslint-config](./eslint-config/README.md) - Shared ESLint configurations and linting rules.
- [typescript-config](./typescript-config/README.md) - Shared TypeScript compiler options and base tsconfig presets.
