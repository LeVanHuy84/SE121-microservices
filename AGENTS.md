# AGENTS.md — Agent Workspace Handbook

Welcome to the **SE121-microservices** monorepo! This is a workspace configuration guide and repository map to help coding agents navigate the codebase, understand architecture rules, run commands, and avoid breaking patterns.

---

## 1. Project Overview

SE121-microservices is an event-driven social networking backend monorepo with integrated mental health awareness features. 
- **Core Domain**: Profile management, social relations, posts, feeds, groups, chats, and automated emotional intelligence/sentiment analysis (e.g., text, music recommendations, and chatbot interactions).
- **Core Strategy**: A monorepo structured with Turborepo utilizing NestJS for TypeScript microservices and FastAPI for Python AI/chatbot components.

---

## 2. Monorepo Repository Structure

```
SE121-microservices/
├── apps/                                # Monorepo microservices
│   ├── api-gateway/                     # Gateway BFF proxying HTTP and handling socket.io connections
│   ├── user-social-service/             # Combined user profiles (Drizzle/PostgreSQL) and social relations
│   ├── content-feed-service/            # Feed aggregation and ranking (MongoDB/Redis)
│   ├── emotion-intelligence-service/    # Emotion profile management and indexing (Mongoose/MongoDB)
│   ├── search-service/                  # Search indexing (Elasticsearch)
│   ├── chat-service/                    # Chat system with outbox pattern
│   ├── chatbot-service/                 # Python RAG / AI assistant service
│   ├── analysis-service/                # Python emotion analytics (PhoBERT, FER, CLIP)
│   ├── group-service/                   # Community groups
│   ├── music-service/                   # Music recommendation system
│   └── recommendation-service/          # Profile/graph-based recommendations
├── packages/                            # Shared workspace libraries
│   ├── common/                          # Core Kafka, Redis, RabbitMQ, and exception filters
│   ├── dtos/                            # Shared type definitions and validated DTOs
│   ├── eslint-config/                   # Unified linting rules
│   └── typescript-config/               # Shared tsconfig blueprints
├── docker-compose.yml                   # Infra dependencies (Kafka, Redis, RabbitMQ, Elasticsearch, Kibana)
├── package.json                         # Workspace-wide devDependencies and build tooling scripts
└── turbo.json                           # Turborepo task pipeline configuration
```

---

## 3. Technology Stack

- **Runtime**: Node.js >=18, Python 3.10+
- **Primary Backend Framework**: NestJS 11.x (TypeScript 5.7+)
- **Python Frameworks**: FastAPI (for AI analysis and RAG chatbot services)
- **Shared Package Management**: npm workspaces (npm v10+)
- **Monorepo Build Orchestration**: Turborepo 2.x
- **Databases**:
  - PostgreSQL (via Drizzle ORM in `user-social-service`)
  - MongoDB (via Mongoose/Mongoose schemas)
  - Elasticsearch 9.x (for full-text search)
  - Redis 7 (caching, pub/sub, socket.io adapter)
- **Messaging & Event Streaming**:
  - Kafka (via `@nestjs/microservices` & `kafkajs`)
  - RabbitMQ (via amqp-connection-manager)

---

## 4. Development & Build Commands

All main commands are ran from the root directory using Turborepo or npm workspaces:

```bash
# Install dependencies for all apps and packages
npm install

# Start infrastructure services (Kafka, Redis, RabbitMQ, Elasticsearch, Kibana)
docker-compose up -d

# Start all microservices in watch/development mode (parallel execution)
npm run start:dev

# Run type-checks across all packages and apps
npm run check-types

# Format all code files
npm run format

# Run linter and auto-fix rules
npm run lint

# Build all applications and packages
npm run build
```

---

## 5. Architectural & Communication Conventions

### 5.1 Communication Matrix
- **External to Gateway**: Clients interact with the `api-gateway` (port `4000`) using HTTP/REST or Socket.io.
- **Inter-service RPC (Sync)**: Microservices communicate with each other over **TCP** (ports starting at `4001`).
- **Asynchronous Events (Async)**: Microservices emit and consume events asynchronously via **Kafka** topics.

### 5.2 Kafka Event Conventions
Topics are managed and verified in the `@repo/dtos` under `EventTopic`. 

Some key Kafka topics include:
- `user-events` (`EventTopic.USER`)
- `post-events` (`EventTopic.POST`)
- `group-events` (`EventTopic.GROUP`)
- `emotion-result-events` (`EventTopic.EMOTION_RESULT`)
- `recommendation-graph-events` (`EventTopic.RECOMMENDATION_GRAPH`)

### 5.3 Exception Filters
All TCP microservices should register and use the shared `ExceptionsFilter` from `@repo/common`:
```typescript
import { ExceptionsFilter } from '@repo/common';

tcpApp.useGlobalFilters(new ExceptionsFilter());
```

---

## 6. Database and Migration Setup

### Drizzle (user-social-service)
- **Schemas**: Located in [apps/user-social-service/src/drizzle/schema/](file:///D:/VsCode/NestJS/projects/SE121-microservices/apps/user-social-service/src/drizzle/schema/)
- **Configuration**: Managed in `apps/user-social-service/drizzle.config.ts`
- **Commands**: Run kit commands directly inside `apps/user-social-service/`:
  ```bash
  # Generate migrations from schemas
  npx drizzle-kit generate
  # Run outstanding migrations
  npx drizzle-kit migrate
  ```

### Mongoose/MongoDB (content-feed-service, emotion-intelligence-service, etc.)
- Schemas are defined inside module directories of individual services using standard `@nestjs/mongoose` configurations.

---

## 7. Coding Standards & Best Practices

1. **Strict Types**: Always compile with `strict: true`. Avoid use of `any` where possible.
2. **DTO Sharing**: Never define API interfaces or DTOs locally in a service if they are used across boundaries. Define them in `packages/dtos` and import them via `@repo/dtos`.
3. **Internal Helpers**: Import common services and client configurations (Redis, Kafka, RabbitMQ) from the shared `@repo/common` module.
4. **Naming Rules**:
   - NestJS modules: `*.module.ts`
   - Controllers: `*.controller.ts`
   - Services: `*.service.ts`
   - DTOs: `*.dto.ts`
   - Drizzle Schemas: `*.schema.ts`

---

## 8. Gotchas and Constraints

- **CI Actions**: The CI configuration in [.github/workflows/ci.yml](file:///D:/VsCode/NestJS/projects/SE121-microservices/.github/workflows/ci.yml) is currently **disabled** (`on: []`). Ensure builds pass locally using `npm run build` before pushing.
- **Kafka Hostname Resolving**: For host machine dev tools, use Kafka port `9092`. For internal container-to-container traffic, Kafka uses port `9093`.
- **Local Shared Package Dependencies**: If you modify `@repo/dtos` or `@repo/common`, you must run `npm run build` at the root for other workspace packages to pick up the updated type definitions in their `dist/` directories.

---

## 9. Verification Checklist

Before declaring any task complete, verify the following:
- [ ] Run `npm run check-types` at the root and verify no compilation errors.
- [ ] Run `npm run lint` and verify there are no lint failures.
- [ ] Run `npm run build` at the root and confirm all apps and shared libraries build cleanly.
- [ ] Ensure that new DTOs are defined and exported from `@repo/dtos` rather than created locally in a service module.
- [ ] If Drizzle database schemas were updated, run `drizzle-kit generate` and ensure the generated migration files are checked in.
- [ ] Verify that any added network transport or message pattern has exceptions guarded with `ExceptionsFilter` or `GatewayExceptionsFilter`.
