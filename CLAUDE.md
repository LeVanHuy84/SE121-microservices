# CLAUDE.md — Microservices Platform for Mental Health Social Network

**Last Updated**: March 5, 2026  
**Architecture**: Event-driven microservices monorepo  
**Domain**: Social media platform with AI-powered emotion analysis and mental health support

---

## 1. Project Overview

Social networking platform with mental health awareness features including:

- Real-time emotion analysis from text (Vietnamese) and images
- Personalized feed ranking based on user emotional state
- Content safety filtering for high-risk users
- Graph-based social relationships
- Real-time chat and notifications
- Trending content with emotion context

**Key differentiators**:

- Emotion-aware feed algorithm that protects vulnerable users
- AI models for Vietnamese text emotion detection (PhoBERT + Qwen2.5)
- Image context analysis using CLIP (not just facial recognition)
- Risk scoring based on posting patterns

---

## 2. Technology Stack

### Languages & Frameworks

- **TypeScript 5.9.2** — All NestJS services
- **Node.js ≥18** — Runtime for NestJS services
- **Python 3.x** — analysis-service only

### Backend Frameworks

- **NestJS 11.x** — Primary microservices framework
- **FastAPI 0.115.2** — Python AI service
- **Drizzle ORM 0.44.5** — PostgreSQL for user-service

### Build & Tooling

- **Turborepo 2.5.6** — Monorepo orchestration
- **npm 10.9.2** — Package manager (workspaces enabled)
- **Prettier 3.6.2** — Code formatting
- **ESLint** — Linting (typescript-eslint + turbo plugin)

### Messaging & Events

- **Kafka (Confluent 7.6.1)** — Event streaming (POST.CREATED, STATS, EMOTION_RESULT)
- **RabbitMQ 3** — Task queuing (notifications, outbox pattern)
- **Redis 7** — Pub/sub, caching, WebSocket adapter

### Data Storage

- **PostgreSQL** — User profiles (user-service)
- **MongoDB** — Posts, messages, feeds, groups
- **Neo4j 5** — Social graph (friendships, follows)
- **Elasticsearch 9.1.7** — Full-text search, logging
- **Redis** — Caching, session, ZSETs for trending/ranking

### AI/ML Stack (analysis-service)

- **PyTorch 2.2.2** — Deep learning runtime
- **Transformers 4.41.2** — HuggingFace models
- **PhoBERT** (`visolex/phobert-emotion`) — Vietnamese emotion baseline
- **Qwen2.5-1.5B-Instruct** — Complex emotion detection (sarcasm, passive-aggressive)
- **CLIP ViT-B-32** (OpenCLIP/LAION-2B) — Image context analysis
- **TensorFlow 2.14.0** — FER (legacy, being phased out)

### Infrastructure

- **Docker Compose** — Local development environment
- **Kafka UI** — Kafka monitoring (port 8080)
- **Kibana 9.1.7** — Elasticsearch visualization
- **Neo4j Browser** — Graph database UI (port 7474)

---

## 3. Architecture & Project Structure

### 3.1 Architecture Pattern

**Event-Driven Microservices** with:

- **API Gateway** — Single entry point, WebSocket support (Socket.io)
- **Service Mesh** — TCP + Kafka + Redis transports
- **CQRS lite** — Separate Kafka consumers from TCP handlers
- **Outbox Pattern** — Guaranteed event delivery (chat-service)

### 3.2 Service Communication Matrix

| Service              | Port | HTTP  | TCP | Kafka       | Redis | Database       |
| -------------------- | ---- | ----- | --- | ----------- | ----- | -------------- |
| **api-gateway**      | 4000 | ✅    | —   | (consumer)  | ✅    | —              |
| **user-service**     | 4001 | —     | ✅  | —           | ✅    | PostgreSQL     |
| **post-service**     | 4002 | ✅    | ✅  | ✅          | ✅    | MongoDB        |
| **feed-service**     | 4003 | —     | ✅  | ✅          | ✅    | MongoDB, Redis |
| **social-service**   | 4004 | —     | ✅  | —           | —     | Neo4j          |
| **media-service**    | 4005 | (TBD) | ✅  | ✅          | —     | Cloudinary API |
| **notification-svc** | 4006 | —     | ✅  | —           | —     | RabbitMQ       |
| **logging-service**  | 4007 | ✅    | —   | ✅          | —     | Elasticsearch  |
| **group-service**    | 4008 | —     | ✅  | ✅          | —     | MongoDB        |
| **search-service**   | 4009 | —     | ✅  | ✅          | —     | Elasticsearch  |
| **chat-service**     | 4010 | —     | ✅  | ✅ (outbox) | —     | MongoDB        |
| **analysis-service** | 8003 | ✅    | ✅  | ✅          | ✅    | MongoDB, Redis |

### 3.3 Kafka Event Topics

**Key events**:

- `POST.CREATED` → feed-service, search-service, analysis-service
- `POST.STATS` → feed-service (engagement scoring)
- `EMOTION_RESULT` → feed-service (emotion indexing)
- `MESSAGE.CREATED` → chat-service outbox
- `USER.CREATED`, `USER.UPDATED` → various consumers

### 3.4 Monorepo Structure

```
microservices/
├── apps/                          # All microservices
│   ├── api-gateway/               # HTTP + WebSocket gateway (Clerk auth)
│   ├── user-service/              # User profiles (Drizzle + PostgreSQL)
│   ├── post-service/              # Posts, reactions, comments, shares
│   ├── feed-service/              # Feed ranking, trending (emotion-aware)
│   ├── social-service/            # Friendships (Neo4j graph)
│   ├── chat-service/              # 1-on-1 messaging (outbox pattern)
│   ├── group-service/             # Group management
│   ├── search-service/            # Elasticsearch indexing
│   ├── logging-service/           # Centralized logging (ELK)
│   ├── notification-service/      # Push notifications (RabbitMQ)
│   ├── media-service/             # Cloudinary upload
│   └── analysis-service/          # Python AI emotion analysis
│
├── packages/                      # Shared libraries
│   ├── common/                    # Kafka, Redis, RabbitMQ clients, filters
│   ├── dtos/                      # Shared DTOs (class-validator)
│   ├── eslint-config/             # ESLint base config
│   └── typescript-config/         # Shared tsconfig
│
├── docs/                          # Technical documentation
│   ├── analysis/                  # AI model architecture docs
│   └── feed/                      # Feed algorithm specs
│
├── docker-compose.yml             # Infrastructure services
├── turbo.json                     # Build pipeline config
└── package.json                   # Root workspace config
```

### 3.5 Service Responsibilities

#### **api-gateway** (NestJS)

- **Role**: HTTP/REST API + WebSocket gateway
- **Auth**: Clerk integration (`@clerk/backend`)
- **Features**:
  - Route proxying to microservices
  - WebSocket rooms (Socket.io + Redis adapter)
  - Rate limiting (`@nestjs/throttler`)
  - Global error handling

#### **user-service** (NestJS + Drizzle)

- **Role**: User profile management
- **Database**: PostgreSQL via Drizzle ORM
- **Transports**: TCP (4001), Redis
- **Features**:
  - CRUD operations
  - Admin user management
  - Drizzle migrations

#### **post-service** (NestJS)

- **Role**: Post lifecycle, reactions, comments, shares
- **Database**: MongoDB
- **Transports**: HTTP, TCP, Kafka
- **Events out**: `POST.CREATED`, `POST.STATS`
- **Features**:
  - Post CRUD with media references
  - Engagement tracking (likes, reactions, shares)
  - Kafka event emission

#### **feed-service** (NestJS)

- **Role**: Feed generation, trending, emotion-aware ranking
- **Database**: MongoDB + Redis
- **Algorithm**:
  - **Personal Feed**: Affinity × EmotionalState × Freshness × Diversity
  - **Trending**: Engagement × Freshness × EmotionBoost × Quality
  - **Content Safety**: Filters negative for high-risk users (riskScore > 0.7)
- **Consumers**:
  - `POST.CREATED` → Cache in Redis ZSET (score=8)
  - `POST.STATS` → Update engagement score
  - `EMOTION_RESULT` → Index emotion intensity
- **Decay**: Cron job reduces scores every 10 minutes

#### **social-service** (NestJS + Neo4j)

- **Role**: Social graph (friends, followers, blocks)
- **Database**: Neo4j 5
- **Transports**: TCP
- **Patterns**: Cypher queries for relationship status

#### **chat-service** (NestJS)

- **Role**: 1-on-1 messaging
- **Database**: MongoDB
- **Patterns**: Outbox pattern with Kafka for guaranteed delivery
- **Transports**: TCP, Kafka

#### **group-service** (NestJS)

- **Role**: Group/community management
- **Database**: MongoDB
- **Transports**: TCP, Kafka

#### **search-service** (NestJS)

- **Role**: Full-text search indexing
- **Database**: Elasticsearch 9.1.7
- **Consumers**: `POST.CREATED` (index posts)

#### **logging-service** (NestJS)

- **Role**: Centralized log aggregation
- **Database**: Elasticsearch + Kibana
- **Transports**: HTTP (ingestion), Kafka

#### **notification-service** (NestJS)

- **Role**: Push notifications, user preferences
- **Broker**: RabbitMQ (exchanges: notifications, user-preference)
- **Transports**: TCP

#### **media-service** (NestJS)

- **Role**: Image/video upload via Cloudinary
- **Transports**: TCP, Kafka

#### **analysis-service** (Python + FastAPI)

- **Role**: AI-powered emotion analysis
- **Database**: MongoDB (history), Redis (cache)
- **Models**:
  - **PhoBERT** (80% coverage) — Simple Vietnamese text emotion
  - **Qwen2.5-1.5B** (20% coverage) — Sarcasm, complex emotions (auto-trigger on low confidence)
  - **CLIP ViT-B-32** — Image context (memes, scenes, not just faces)
- **Risk Scoring**:
  - Analyzes last 30 posts
  - Detects critical keywords
  - Temporal patterns (late-night negative posting)
  - Outputs: low / medium / high / critical
- **Latency**:
  - Text only (simple): ~250ms
  - Text only (complex): ~850ms
  - Text + 1 image: ~650ms
- **Endpoints**:
  - `POST /analyze` — Analyze text + images
  - `POST /moderation` — Content moderation check
- **Consumers**: Kafka `POST.CREATED` → async analysis → emit `EMOTION_RESULT`

---

## 4. Development Commands

### 4.1 Installation

```bash
# Root dependencies (Turborepo, Prettier, TypeScript)
npm install

# Auto-installs all workspace dependencies (apps/*, packages/*)
# No need to cd into each service
```

### 4.2 Infrastructure (Docker)

```bash
# Start all infra services (Kafka, Redis, MongoDB, etc.)
docker-compose up -d

# Stop all
docker-compose down

# View logs
docker-compose logs -f kafka
```

**Services started**:

- Kafka: `localhost:9092`
- Kafka UI: `http://localhost:8080`
- Redis: `localhost:6379`
- RabbitMQ: `localhost:5672` (management: `http://localhost:15672`)
- Elasticsearch: `localhost:9200`
- Kibana: `http://localhost:5601`
- Neo4j: `localhost:7687` (browser: `http://localhost:7474`, auth: `neo4j/secretpassword`)

### 4.3 Development Workflow

```bash
# Run all services in dev mode (parallel, max 12 concurrency)
npm run start:dev

# Exclude Python service (faster startup)
npm run dev:test

# Build all services
npm run build

# Lint all (Turbo cache-enabled)
npm run lint

# Format code (Prettier)
npm run format

# Type check
npm run check-types
```

### 4.4 Service-Specific Commands

```bash
# Run single NestJS service
cd apps/user-service
npm run start:dev

# Run Python analysis service
cd apps/analysis-service
pip install -r requirements.txt
python -m app.main
# Or: uvicorn app.main:app --reload --port 8003

# Build single service (Turbo)
npx turbo build --filter=user-service
```

### 4.5 Database Migrations

```bash
# User service (Drizzle)
cd apps/user-service
npx drizzle-kit generate  # Generate migration
npx drizzle-kit migrate   # Run migration
```

### 4.6 Testing

```bash
# All services
npx turbo test

# Single service
cd apps/post-service
npm test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

---

## 5. Critical Coding Workflow

### 5.1 Pre-Commit Checklist

1. **Format** → `npm run format`
2. **Lint** → `npm run lint` (auto-fix enabled)
3. **Type check** → `npm run check-types`
4. **Test** → `npx turbo test` (if applicable)

### 5.2 Code Quality Gates

- **ESLint**: `typescript-eslint` + `eslint-plugin-turbo` + `eslint-config-prettier`
- **Prettier**: Enforced formatting (`.ts`, `.tsx`, `.md`)
- **TypeScript**: Strict mode enabled (`strict: true`)
- **Turbo**: Undeclared env vars trigger warning

### 5.3 Adding New Features

**For NestJS services**:

1. Add DTO in `packages/dtos/src/{domain}/`
2. Update exports in `packages/dtos/src/index.ts`
3. Implement in service module (`apps/{service}/src/modules/{feature}/`)
4. Emit Kafka events if needed (use `@repo/common/KafkaService`)
5. Add MessagePattern/EventPattern in controller

**For Python service**:

1. Add route in `apps/analysis-service/app/api/`
2. Include router in `app/main.py`
3. Use Pydantic models in `app/database/schemas/`

---

## 6. Tools / APIs / MCP Integrations

### 6.1 External APIs

- **Clerk** — Authentication in api-gateway
- **Cloudinary** — Media upload in media-service

### 6.2 Internal Shared Packages

#### `@repo/common`

- **Exports**: KafkaModule, KafkaService, RedisModule, RedisService, RabbitmqModule, ExceptionsFilter
- **Usage**: Import in service modules for messaging/caching

```typescript
import { KafkaModule, ExceptionsFilter } from '@repo/common';
```

#### `@repo/dtos`

- **Exports**: All DTOs (user, post, feed, emotion, chat, group, search, notification, log)
- **Validation**: class-validator + class-transformer

```typescript
import { CreatePostDTO, EmotionResultDTO } from '@repo/dtos';
```

#### `@repo/eslint-config`

- **Exports**: `config` (ESLint base rules)
- **Usage**: `import { config } from '@repo/eslint-config/base';`

#### `@repo/typescript-config`

- **Configs**: `base.json`, `nextjs.json`, `react-library.json`
- **Usage**: `"extends": "@repo/typescript-config/base.json"`

### 6.3 Monitoring & Debugging Tools

- **Kafka UI**: Browse topics, view messages (`http://localhost:8080`)
- **Kibana**: Search indexed posts, view logs (`http://localhost:5601`)
- **Neo4j Browser**: Visualize social graph (`http://localhost:7474`)
- **RabbitMQ Management**: Queue monitoring (`http://localhost:15672`, guest/guest)

---

## 7. Golden Reference Files

### 7.1 NestJS Service Patterns

**Multi-transport setup** (TCP + Kafka):

- `apps/feed-service/src/main.ts` — Separate TCP and Kafka apps
- `apps/post-service/src/main.ts` — HTTP + TCP + Redis + Kafka in one app
- `apps/user-service/src/main.ts` — TCP + Redis with command service pattern

**Kafka consumer**:

- `apps/feed-service/src/modules/ingestion/service/ingestion-post.service.ts`
  - EventPattern for `POST.CREATED`
  - Redis ZSET manipulation
  - MongoDB snapshot storage

**TCP message handler**:

- `apps/user-service/src/module/user.controller.ts`
  - MessagePattern for RPC calls
  - Inter-service communication via ClientProxy

**Feed ranking algorithm**:

- `apps/feed-service/src/modules/ranking/strategies/personal-ranking.strategy.ts`
  - Emotion-aware content filtering
  - High-risk user protection logic
- `apps/feed-service/src/modules/ranking/strategies/trending-ranking.strategy.ts`
  - Engagement scoring formula
  - Exponential decay implementation

### 7.2 Python AI Service

**Model loading**:

- `apps/analysis-service/app/services/model_loader.py`
  - Lazy model initialization
  - HuggingFace transformers + PyTorch setup

**Emotion analysis pipeline**:

- `apps/analysis-service/app/api/analyze_api.py`
  - Text + image processing
  - 2-tier text analysis (PhoBERT → Qwen2.5 fallback)
  - CLIP image context detection

**Risk scoring**:

- `apps/analysis-service/app/services/risk_scorer.py` (inferred)
  - Historical pattern analysis
  - Critical keyword detection

### 7.3 Shared DTO Patterns

**Standardized response**:

- `packages/dtos/src/common/` (inferred)
  - Pagination, error structures

**Emotion DTOs**:

- `packages/dtos/src/emotion/analysis-detail.dto.ts`
- `packages/dtos/src/emotion/emotion-daily-trend.dto.ts`

### 7.4 Infrastructure Config

**Docker Compose**:

- `docker-compose.yml` — Kafka, Zookeeper, Redis, RabbitMQ, ES, Kibana, Neo4j
- Note: External listener for Kafka at `localhost:9092`, internal at `kafka:9093`

**Drizzle**:

- `apps/user-service/drizzle.config.ts` — Schema path pattern, PostgreSQL dialect

---

## 8. Coding Standards & Design Philosophy

### 8.1 TypeScript Conventions

- **Strict mode**: Always enabled
- **No implicit any**: Enforced
- **Module system**: NodeNext (ESM)
- **Naming**:
  - Services: `*.service.ts`
  - Controllers: `*.controller.ts`
  - DTOs: `*.dto.ts`
  - Modules: `*.module.ts`
  - Schemas (Drizzle): `*.schema.ts`

### 8.2 NestJS Best Practices

- **Dependency Injection**: Constructor-based
- **Error Handling**: Global ExceptionsFilter from `@repo/common`
- **Validation**: class-validator DTOs at controller layer
- **Async/Await**: Preferred over callbacks
- **Config**: `@nestjs/config` with `.env` files
- **Microservices**:
  - Use `@MessagePattern` for RPC
  - Use `@EventPattern` for fire-and-forget
  - Always set timeout for TCP calls

### 8.3 Event-Driven Patterns

- **Event naming**: `{ENTITY}.{ACTION}` (uppercase, e.g., `POST.CREATED`)
- **Event payload**: Always include `userId`, `timestamp` (auto-added by KafkaService)
- **Idempotency**: Consumer must handle duplicate events (Kafka at-least-once)
- **Dead Letter Queue**: RabbitMQ DLX exchange configured for failures

### 8.4 Database Patterns

- **MongoDB**: Mongoose schemas in `entities/` or `mongo/`
- **PostgreSQL**: Drizzle schemas in `drizzle/schema/`
- **Neo4j**: Cypher queries in service layer (no ORM)
- **Redis**:
  - Caching: `{service}:{entity}:{id}` (e.g., `user:profile:123`)
  - ZSETs: `{service}:{collection}` (e.g., `post:score`)

### 8.5 Python Conventions (analysis-service)

- **Framework**: FastAPI with `lifespan` for model loading
- **Validation**: Pydantic models
- **API versioning**: None (single version, breaking changes require service coordination)
- **Async**: `async`/`await` for I/O (Redis, Kafka, HTTP)
- **Model management**: Singleton loader pattern

---

## 9. Git Workflow & Commit Convention

### 9.1 Branch Strategy

- **main/master**: Production-ready code
- **Feature branches**: Not strictly enforced (inferred from CI on push to master)

### 9.2 Commit Messages

- **Format**: Not strictly enforced via hooks
- **Recommendation**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`)

### 9.3 CI/CD

**GitHub Actions** (`.github/workflows/ci.yml`):

- Trigger: Push to `master` or PR
- Steps: Checkout → (commented out: install, lint, test, build)
- **Status**: CI pipeline is scaffolded but not fully enabled

**No automated deployments** configured yet.

---

## 10. Debugging Notes & Project Terminology

### 10.1 Domain Terminology

- **Emotion Profile**: User's emotional baseline (from analysis-service)
  - `baseline`: Typical emotional state
  - `riskScore`: 0.0–1.0 (0.7+ = high-risk)
  - `negativeStreak`: Consecutive negative posts

- **Emotion Preference**: User settings
  - `preferredEmotions`: Array of emotions to boost
  - `avoidEmotions`: Array of emotions to filter out
  - `allowHealingContent`: Boolean for positive content injection
  - `allowMentalAlert`: Boolean for crisis notifications

- **Affinity**: User's historical engagement with emotion types
  - Tracked in Redis ZSET: `user:{userId}:emotion:affinity`
  - Decay: 30-day TTL

- **Trending Score**: Redis ZSET `post:score`
  - Initial: 8 points on post creation
  - Delta: Reaction (+1), Comment (+3), Share (+4)
  - Decay: Every 10 minutes via cron

- **Content Safety**: Feed filter for high-risk users
  - Boosts positive emotions (×2.5)
  - Suppresses negative emotions (×0.3)

### 10.2 Common Pain Points

**Kafka connection issues**:

- Ensure `KAFKA_BROKERS=localhost:9092` (not `kafka:9093` from host)
- Check `docker-compose logs kafka` for broker readiness

**Redis pub/sub vs caching**:

- WebSocket adapter uses pub/sub (separate channels)
- Caching uses standard GET/SET/ZADD

**Emotion analysis latency**:

- PhoBERT: ~250ms (acceptable)
- Qwen2.5: ~850ms (only for complex cases)
- Consider caching results in Redis by post content hash

**Neo4j Cypher optimization**:

- Always create indexes on `:User(userId)` and `:Friendship` nodes
- Use `MATCH` with labels, avoid full graph scans

**Turborepo cache**:

- Cache stored in `.turbo/` (git-ignored)
- Clear with `rm -rf .turbo` if stale builds

### 10.3 Service Dependencies Graph

```
api-gateway
 ├─> user-service (TCP)
 ├─> post-service (TCP)
 ├─> social-service (TCP)
 ├─> feed-service (TCP)
 ├─> chat-service (TCP)
 └─> analysis-service (HTTP/TCP)

feed-service
 ├─> analysis-service (TCP) — emotion profiles
 └─> Kafka consumers — POST.CREATED, STATS, EMOTION_RESULT

post-service
 └─> Kafka producers — POST.CREATED, POST.STATS

analysis-service
 ├─> Kafka consumers — POST.CREATED
 └─> Kafka producers — EMOTION_RESULT

user-service
 └─> social-service (TCP) — relationship status
```

### 10.4 Environment Variables (Key Patterns)

**NestJS services**:

- `PORT`: TCP port (4001–4010)
- `GATEWAY_PORT`: HTTP port (4000 for api-gateway)
- `DATABASE_URL`: PostgreSQL connection (user-service)
- `KAFKA_BROKERS`: `localhost:9092` (comma-separated)
- `KAFKA_CLIENT_ID`: Unique per service
- `KAFKA_GROUP_ID`: Consumer group (usually `{service-name}-consumer`)

**Python service**:

- `MONGO_URI`: MongoDB connection
- `REDIS_URL`: Redis connection
- `KAFKA_BROKERS`: Same as NestJS

**No .env.example files** exist — infer from code.

### 10.5 Debugging Checklist

1. **Infra not running**: `docker-compose up -d`
2. **Service won't start**:
   - Check port conflicts: `lsof -i :4001` (Linux/Mac) or `netstat -ano | findstr :4001` (Windows)
   - Check env vars: `console.log(process.env.KAFKA_BROKERS)`
3. **Kafka event not received**:
   - Verify topic exists in Kafka UI
   - Check consumer group in Kafka UI (should show lag = 0)
   - Ensure `@EventPattern('TOPIC.NAME')` matches producer topic
4. **Emotion analysis not working**:
   - First run downloads models (~3.5GB), check `apps/analysis-service/models/` directory
   - Check logs: `uvicorn` output or `logs/` directory
5. **Feed ranking unexpected**:
   - Inspect Redis ZSET: `redis-cli ZRANGE post:score 0 -1 WITHSCORES`
   - Check emotion profile: TCP call to analysis-service

---

## 11. DO NOT MODIFY (Sensitive Files)

### 11.1 Auto-Generated Files

- `dist/**` — Build output (all services)
- `node_modules/**` — Dependencies
- `.turbo/**` — Turborepo cache
- `apps/user-service/drizzle/**` — Generated migrations

### 11.2 Infra Configuration (Modify with Caution)

- `docker-compose.yml` — Shared development infra
- `turbo.json` — Build pipeline (affects all services)
- `package.json` (root) — Workspace configuration

### 11.3 Shared Packages (Require Coordination)

- `packages/dtos/**` — Changes affect all services
- `packages/common/**` — Breaking changes cascade
- `packages/eslint-config/**`, `packages/typescript-config/**` — Affects lint/build

### 11.4 AI Model Checkpoints

- `apps/analysis-service/models/**` — Downloaded model weights (not in git)
- Do not delete manually; regenerate via `download_models.py`

### 11.5 Critical Business Logic

- `apps/feed-service/src/modules/ranking/strategies/**` — Feed algorithm (requires PM approval)
- `apps/analysis-service/app/services/risk_scorer.py` (inferred) — Mental health scoring (legal/ethical review)

---

## Appendix: Quick Reference

### Service Ports

| Service          | Port | Protocol         |
| ---------------- | ---- | ---------------- |
| api-gateway      | 4000 | HTTP + WebSocket |
| user-service     | 4001 | TCP, Redis       |
| post-service     | 4002 | HTTP, TCP, Kafka |
| feed-service     | 4003 | TCP, Kafka       |
| social-service   | 4004 | TCP              |
| media-service    | 4005 | TCP, Kafka       |
| notification-svc | 4006 | TCP              |
| logging-service  | 4007 | HTTP, Kafka      |
| group-service    | 4008 | TCP, Kafka       |
| search-service   | 4009 | TCP, Kafka       |
| chat-service     | 4010 | TCP, Kafka       |
| analysis-service | 8003 | HTTP, TCP, Kafka |

### Kafka Topics

- `POST.CREATED`
- `POST.STATS`
- `EMOTION_RESULT`
- `MESSAGE.CREATED`
- `USER.CREATED`, `USER.UPDATED`

### Redis Keys

- `user:{userId}:emotion:affinity` (ZSET, TTL 30d)
- `user:{userId}:emotion:recent` (LIST, max 50)
- `post:score` (ZSET, trending scores)
- `post:meta:{postId}` (HASH, metadata)

### MongoDB Collections (Inferred)

- **post-service**: `posts`, `comments`, `reactions`
- **feed-service**: `posts` (snapshots)
- **chat-service**: `messages`, `conversations`, `outbox`
- **group-service**: `groups`
- **analysis-service**: `emotion_history`

### Neo4j Relationships

- `:User`-`[:FRIEND_WITH]`->`:User`
- `:User`-`[:FOLLOWS]`->`:User`
- `:User`-`[:BLOCKS]`->`:User`

### Emotion Categories

**Positive**: joy, surprise  
**Negative**: sadness, anger, fear, disgust

---

**End of CLAUDE.md**
