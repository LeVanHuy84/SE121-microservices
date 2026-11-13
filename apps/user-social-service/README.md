# user-social-service

## Overview
Identity, social relationship graph, and community group management microservice for Sentimeta. Handles user profile synchronization from Clerk webhooks, friendship/follower status graphs, block lists, community group lifecycle, member permissions, and transactional outbox event publishing to Apache Kafka using PostgreSQL with Drizzle ORM.

## Interface
- **TCP Microservice Patterns** (Listening on TCP port `4001`):
  - `user.sync`, `user.get_by_id`, `user.update_profile`: Profile synchronization and management.
  - `user.admin.list`, `user.admin.change_role`: Administrative user lifecycle workflows.
  - `social.friend_request.send`, `social.friend_request.accept`, `social.friend_request.reject`: Friendship workflows.
  - `social.follow`, `social.unfollow`, `social.block`: Relationship graph transitions.
  - `social.friends.list`, `social.followers.list`: Relationship list and mutual friendship queries.
  - `group.create`, `group.update`, `group.join`, `group.leave`, `group.members.list`: Community group management.
- **Shared Dependencies**: `[common](../../packages/common/README.md)` and `[dtos](../../packages/dtos/README.md)`.

## Invariants
- User profile records are kept synchronized with Clerk identity events.
- Relationship state transitions must be transactional (e.g. mutual friendship acceptance creates bidirectional graph links).
- Domain events (USER_CREATED, FRIENDSHIP_ESTABLISHED, GROUP_JOINED) must write to the PostgreSQL outbox table in the same transaction as state mutations.

## Side Effects
- Mutates user profiles, relationship edges, group memberships, and outbox records in PostgreSQL.
- Caches active user profiles and relationship counters in Redis.
- Background worker polls the outbox table and dispatches events to Apache Kafka (`user-events`, `social-events`, `group-events`).

## Verification
- Run: `npm test` (`jest --passWithNoTests`)

---

## Responsibilities & Operational Details

### Responsibilities

- **Profiles & Auth**: Handle Clerk-authenticated profile creation, synchronization, profile CRUD, and role assignment.
- **Social Graph**: Manage friend/follower relations, relationship state queries (mutual friends, block lists, follow counters).
- **Group Management**: Group creation, joining, member roles, and community reports.
- **Outbox Pattern**: Guarantee reliable domain event publishing (USER, SOCIAL, GROUP events) to Kafka.

### Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4001` (TCP) |
| Transports | TCP, Kafka, Redis |
| Primary storage | PostgreSQL (Drizzle ORM) |
| Cache / Buffer | Redis |
| Shared packages | `@repo/common`, `@repo/dtos` |

### Key Modules

- **User**: Handlers for user profile retrieval, sync, and system admin tools.
- **Social**: Relation graph logic (friend request, block, follow, unfollow).
- **Group**: Core community group operations.
- **Event / Outbox**: Periodic polling (every 5s) of database-logged outbox records, pushing them asynchronously to Kafka.

### Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP microservice listener port | `4001` |
| `DATABASE_URL` | PostgreSQL connection string for Drizzle | — |
| `REDIS_HOST` | Redis host for caching | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |
| `CLERK_SECRET_KEY`| Clerk backend client API secret | — |

### Development

```bash
# Generate database migrations from Drizzle schemas
npx drizzle-kit generate

# Run database migrations
npx drizzle-kit migrate

# Run service locally in dev mode
npm run start:dev
```
