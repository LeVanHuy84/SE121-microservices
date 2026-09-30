# AGENTS.md — Agent Workspace Handbook

Welcome to the **SE121-microservices** monorepo! This is a workspace configuration guide and repository map to help coding agents navigate the codebase, understand architecture rules, run commands, and avoid breaking patterns.

---

## 1. Project Overview

SE121-microservices is an event-driven social networking backend monorepo with integrated mental health awareness features.

- **Core Domain**: Profile management, social relations, community groups, posts, feed generation & ranking, 1-1 & group chats with video calling, full-text search, music recommendations, emotion tracking/insights, and an AI mental health assistant with multi-modal emotion analysis.
- **Architecture**: A consolidated **7-service** monorepo orchestrated with Turborepo utilizing NestJS 11 for TypeScript microservices and FastAPI for the Python AI/Chatbot component.

---

## 2. Monorepo Repository Structure

```
SE121-microservices/
├── apps/                                # Monorepo microservices (7 core services)
│   ├── api-gateway/                     # Gateway BFF proxying HTTP & Socket.io, Clerk auth, rate limiting (Port 4000)
│   ├── user-social-service/             # Users, profiles, Clerk sync, friendships, follows, community groups (Port 4001)
│   ├── content-feed-service/            # Posts, feeds ranking/fan-out, media uploads, notifications, activity logs (Port 4002)
│   ├── search-recommendation-service/   # Search indexing (Elasticsearch), graph/content recommendations, music catalog (Port 4003)
│   ├── chat-service/                    # 1-1 & group chat, outbox pattern, presence, Stream video calls (Port 4004)
│   ├── emotion-intelligence-service/    # Emotion profiles (EMA), snapshots, timeline insights, distress warnings (Port 4005)
│   └── ai-chatbot-service/              # Python FastAPI: Multi-modal emotion analysis (PhoBERT/FER/MERT) & RAG LLM assistant (Port 4006)
├── packages/                            # Shared workspace libraries
│   ├── common/                          # Core Kafka, Redis, RabbitMQ, OpenTelemetry, idempotency, DLQ & RPC filters
│   ├── dtos/                            # Shared type definitions, validated DTOs, and Kafka EventTopic enums
│   ├── eslint-config/                   # Unified linting rules (ESLint 9)
│   └── typescript-config/               # Shared tsconfig blueprints
├── docker-compose.yml                   # Infra dependencies (Kafka, Redis, RabbitMQ, Elasticsearch, Jaeger, Prometheus, Grafana, Loki)
├── package.json                         # Workspace-wide devDependencies and build tooling scripts
└── turbo.json                           # Turborepo task pipeline configuration
```

---

## 3. Technology Stack & Service Breakdown

### 3.1 Infrastructure & Core Stack

- **Runtime**: Node.js >=18 (npm workspaces v10+), Python 3.10+
- **Primary Backend Framework**: NestJS 11.x (TypeScript 5.7+)
- **Python Framework**: FastAPI (Uvicorn, Pydantic v2, PyTorch CPU, Hugging Face Transformers, ONNX Runtime)
- **Monorepo Build Orchestration**: Turborepo 2.x
- **Databases & Storage**:
  - **PostgreSQL**: Managed via Drizzle ORM in `user-social-service` and TypeORM in `search-recommendation-service` (Music)
  - **MongoDB**: Managed via Mongoose in `content-feed-service`, `chat-service`, and `emotion-intelligence-service` (and Motor in `ai-chatbot-service`)
  - **Elasticsearch 9.x**: Full-text search, user/post search indexing, and RAG document vector search
  - **Redis 7**: Caching, feed fanout/caching, Socket.io Redis adapter, Bull queues, and chatbot session memory
  - **Cloudinary**: Media assets and CDN
- **Messaging & Event Streaming**:
  - **Kafka**: Asynchronous event streaming (`kafkajs` & `@nestjs/microservices`, `aiokafka` in Python)
  - **RabbitMQ**: Task queueing and notification routing (`amqp-connection-manager`)
- **Observability & Monitoring**:
  - **OpenTelemetry (OTel)**: Distributed tracing across all services with Jaeger exporter
  - **Prometheus & Grafana**: Service metrics (Prometheus scrapers on ports `5000`-`5006`)
  - **Loki & Promtail**: Centralized log aggregation

### 3.2 Service Matrix & Port Mapping

| Service                           | Language / Framework  | Inter-Service Port | Metrics Port | Primary Storage                    | Key Responsibilities                                                                                                    |
| --------------------------------- | --------------------- | ------------------ | ------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **api-gateway**                   | NestJS 11             | `4000` (HTTP/WS)   | `5000`       | Redis                              | API Gateway BFF, Clerk Auth, Socket.io Gateway, Rate Limiting, Stream Video Webhooks                                    |
| **user-social-service**           | NestJS 11             | `4001` (TCP)       | `5001`       | PostgreSQL (Drizzle), Redis        | User profiles, Clerk sync, Social graph (friends, follows, blocks), Community Groups & Events                           |
| **content-feed-service**          | NestJS 11             | `4002` (TCP)       | `5002`       | MongoDB (Mongoose), Redis          | Post CRUD & interactions, Feed ranking/fan-out, Media upload handling, In-app/Push Notifications, Activity logging      |
| **search-recommendation-service** | NestJS 11             | `4003` (TCP)       | `5003`       | Elasticsearch 9, PostgreSQL, Redis | Full-text search, Recommendation algorithms (friends, posts, groups), Music recommendation & catalog                    |
| **chat-service**                  | NestJS 11             | `4004` (TCP)       | `5004`       | MongoDB (Mongoose), Redis          | 1-1 & Group Chats, Message persistence, Outbox pattern, User presence, Stream Video / Audio calls                       |
| **emotion-intelligence-service**  | NestJS 11             | `4005` (TCP)       | `5005`       | MongoDB (Mongoose), Redis          | Emotion profile tracking (EMA), Daily snapshots, Timeline analytics, Distress warnings, Admin insight dashboards        |
| **ai-chatbot-service**            | Python 3.10 / FastAPI | `4006` (HTTP)      | `5006`       | Redis, MongoDB, Elasticsearch      | Multi-modal emotion analysis (PhoBERT text, FER image, MERT audio), RAG Mental Health Chatbot (Groq LLM/VLM, LangChain) |

---

## 4. Development & Build Commands

All main workspace commands are executed from the root directory using Turborepo or npm workspaces:

```bash
# Install dependencies for all apps and packages
npm install

# Start infrastructure services (Kafka, Redis, RabbitMQ, Elasticsearch, Jaeger, Prometheus, Grafana, Loki)
docker-compose up -d

# Start all 7 microservices in watch/development mode (parallel execution)
npm run start:dev

# Run type-checks across all TypeScript packages and apps
npm run check-types

# Format all code files (TypeScript & Markdown)
npm run format

# Run linter and auto-fix rules
npm run lint

# Build all applications and packages
npm run build
```

### 4.1 Python AI Service Commands (`apps/ai-chatbot-service/`)

```bash
# Activate virtual environment
npm --workspace=ai-chatbot-service run venv

# Install Python dependencies
npm --workspace=ai-chatbot-service run install

# Re-index RAG documents to Elasticsearch
npm --workspace=ai-chatbot-service run rag:index-docs

# Run linter and formatter (Ruff)
npm --workspace=ai-chatbot-service run lint
npm --workspace=ai-chatbot-service run format
```

### 4.2 Database Migrations & Seeding

```bash
# Drizzle ORM migrations (user-social-service)
cd apps/user-social-service
npx drizzle-kit generate
npx drizzle-kit migrate

# Database seed commands (from root)
npm run seed:clerk            # Seed mock Clerk users
npm run seed:chat             # Seed chat conversations & messages
npm run seed:music            # Seed music catalog & embeddings
npm run seed:search           # Seed Elasticsearch search indices
npm run seed:emotion          # Seed emotion logs & profiles
```

---

## 5. Architectural & Communication Conventions

### 5.1 Communication Protocols

- **Client → Gateway**: Clients interact with `api-gateway` (port `4000`) over **HTTP/REST** or **WebSocket (Socket.io)**.
- **Gateway → TypeScript Services**: Synchronous RPC over **TCP** (ports `4001`-`4005`).
- **Gateway → AI Service**: Synchronous requests over **HTTP** (`http://localhost:4006` or `http://ai-chatbot-service:4006`).
- **Asynchronous Events**: Cross-service events are published and consumed via **Kafka** topics with built-in retry, idempotency, and Dead Letter Queue (DLQ) support from `@repo/common`.

### 5.2 Kafka Event Topics (`EventTopic`)

Topics are declared in `@repo/dtos` (`EventTopic` enum):

- `user-events` (`EventTopic.USER`)
- `post-events` (`EventTopic.POST`)
- `group-events` (`EventTopic.GROUP`)
- `group-crud-events` (`EventTopic.GROUP_CRUD`)
- `chat-events` (`EventTopic.CHAT`)
- `media-events` (`EventTopic.MEDIA`)
- `analysis-events` (`EventTopic.ANALYSIS`)
- `analysis-result-events` (`EventTopic.ANALYSIS_RESULT`)
- `recommendation-profile-events` (`EventTopic.RECOMMENDATION_PROFILE`)
- `recommendation-graph-events` (`EventTopic.RECOMMENDATION_GRAPH`)
- `recommendation-result-events` (`EventTopic.RECOMMENDATION_RESULT`)
- `logging-events` (`EventTopic.LOGGING`)
- `user-activity-log-events` (`EventTopic.USER_ACTIVITY_LOG`)

### 5.3 Exception Handling & Filters

- All TCP microservices register and use the shared `RpcExceptionFilter` from `@repo/common`:

  ```typescript
  import { RpcExceptionFilter } from "@repo/common";

  app.useGlobalFilters(new RpcExceptionFilter());
  ```

- The API Gateway uses `GatewayExceptionsFilter` to translate downstream RPC and internal exceptions into structured HTTP error responses.

---

## 6. Coding Standards & Best Practices

1. **Strict Type Safety**: Always compile with TypeScript strict mode enabled. Avoid `any` types.
2. **Centralized DTOs**: Never define API request/response structures or Kafka event payloads locally in a service if they cross service boundaries. Always define and export them from `packages/dtos` (`@repo/dtos`).
3. **Shared Infrastructure Modules**: Import Redis, Kafka, RabbitMQ, Idempotency, DLQ, and OpenTelemetry helpers directly from `packages/common` (`@repo/common`).
4. **Environment Variables**:
   - **NEVER** read `.env` or `.env.local` files to protect credentials.
   - Always reference `.env.example` templates in the root or individual service folders.
5. **Naming Conventions**:
   - NestJS modules: `*.module.ts`
   - Controllers: `*.controller.ts`
   - Services: `*.service.ts`
   - DTOs: `*.dto.ts`
   - Drizzle Schemas: `*.schema.ts`
   - Python FastAPI routers: `*.router.py`

---

## 7. Gotchas and Constraints

- **Local Shared Package Dependencies**: When modifying `@repo/dtos` or `@repo/common`, run `npm run build` at the root so that other workspace packages pick up the freshly compiled `dist/` types.
- **Kafka Hostname Resolution**:
  - For local host development: Kafka runs on port `9092`.
  - For Docker container-to-container communication: Kafka runs on port `9093`.
- **Python Virtual Environment**: `ai-chatbot-service` requires a local Python virtual environment (`.venv`) for local execution via `npm run start:dev`.
- **Idempotency & Outbox**: Event-driven consumers should leverage the `@repo/common` Idempotency service to prevent duplicate message processing across consumer groups.

---

## 8. Verification Checklist

Before declaring any task complete, verify the following:

- [ ] Run `npm run check-types` at the root and verify zero compilation errors.
- [ ] Run `npm run lint` and verify no lint failures.
- [ ] Run `npm run build` at the root and confirm all 7 apps and shared packages build cleanly.
- [ ] Ensure that new cross-service DTOs or event contracts are exported from `@repo/dtos`.
- [ ] If Drizzle database schemas were updated, run `drizzle-kit generate` in `apps/user-social-service` and verify migration files.
- [ ] Verify that any added network transport or message pattern is properly guarded with `RpcExceptionFilter` or `GatewayExceptionsFilter`.
