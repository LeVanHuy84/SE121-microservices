# user-social-service

The user-social-service handles user profiles, admin system workflows, follower/friendship relationship graphs, community groups, and transaction outbox event logging.

## Responsibilities

- **Profiles & Auth**: Handle Clerk-authenticated profile creation, synchronization, profile CRUD, and role assignment.
- **Social Graph**: Manage friend/follower relations, relationship state queries (mutual friends, block lists, follow counters).
- **Group Management**: Group creation, joining, member roles, and community reports.
- **Outbox Pattern**: Guarantee reliable domain event publishing (USER, SOCIAL, GROUP events) to Kafka.

## Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4001` (TCP) |
| Transports | TCP, Kafka, Redis |
| Primary storage | PostgreSQL (Drizzle ORM) |
| Cache / Buffer | Redis |
| Shared packages | `@repo/common`, `@repo/dtos` |

## Key Modules

- **User**: Handlers for user profile retrieval, sync, and system admin tools.
- **Social**: Relation graph logic (friend request, block, follow, unfollow).
- **Group**: Core community group operations.
- **Event / Outbox**: Periodic polling (every 5s) of database-logged outbox records, pushing them asynchronously to Kafka.

## Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP microservice listener port | `4001` |
| `DATABASE_URL` | PostgreSQL connection string for Drizzle | — |
| `REDIS_HOST` | Redis host for caching | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |
| `CLERK_SECRET_KEY`| Clerk backend client API secret | — |

## Development

```bash
# Generate database migrations from Drizzle schemas
npx drizzle-kit generate

# Run database migrations
npx drizzle-kit migrate

# Run service locally in dev mode
npm run start:dev
```
