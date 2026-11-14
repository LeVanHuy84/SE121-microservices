# emotion-intelligence-service

## Overview
NestJS analytics and psychological safety microservice that compiles longitudinal emotional profiles, aggregates mental health trend dashboards (joy, sadness, anger, fear, disgust), evaluates mental wellbeing risk baselines, runs proactive AI sweeps, and dispatches LLM-backed empathetic suggestions.

## Interface
- **TCP Microservice Patterns** (Listening on TCP port `4005` via `@TcpMessagePattern`):
  - `emotion.profile.get`: Retrieves aggregated user emotion profile across selected timeframes.
  - `emotion.history.list`: Retrieves granular emotion detection records for posts/messages.
  - `emotion.admin.dashboard`: Aggregates platform-wide emotional distribution and anomaly metrics.
  - `emotion.feedback.submit`: Records user feedback on emotion classification accuracy.
  - `moderation.appeal.create`, `moderation.appeal.review`: Processes content moderation appeals.
- **Kafka Consumers**: Consumes analysis outputs from `ai-chatbot-service` via Kafka topics (`emotion-analyzed`, `content-moderated`).
- **Shared Dependencies**: `[common](../../packages/common/README.md)` and `[dtos](../../packages/dtos/README.md)`.

## Invariants
- Emotional anomaly baselines are calculated against user 14-day rolling averages.
- Severe negative emotional clustering triggers empathetic support notifications without exposing sensitive private details.
- Proactive AI sweeps are scheduled via cron (`PROACTIVE_SWEEP_CRON`) to flag persistent negative trends.

## Side Effects
- Persists user emotion records, historical timelines, and moderation appeals in MongoDB.
- Caches dashboard summary aggregates in Redis.
- Queries Groq API (`llama-3.3-70b-versatile`) to generate empathetic psychological wellbeing guidance.
- Emits wellbeing alerts and recommendation trigger events to Kafka.

## Verification
- Run: `npm test` (`jest --passWithNoTests`)

---

## Responsibilities & Operational Details

### Responsibilities

- **Dashboard Aggregation**: Summarize trends and distributions of emotions (joy, sadness, anger, fear, disgust) for users and admins.
- **Risk Evaluation**: Ingest emotion results, compute user risk baselines, and flag anomalies.
- **Support Advice**: Leverage LLM integration to generate empathetic, supportive suggestions when risk is flagged.

### Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4005` (TCP) |
| Transports | TCP, Kafka, Redis, RabbitMQ |
| Primary storage | MongoDB (Mongoose) |
| Shared packages | `@repo/common`, `@repo/dtos` |

### Environment Variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | TCP listener port | `4005` |
| `MONGODB_URI` | MongoDB connection string | — |
| `REDIS_HOST` | Redis host for caching | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `KAFKA_BROKERS` | Kafka broker endpoints | `localhost:9092` |
| `GROQ_API_KEY` | Optional Groq LLM API Key | — |
| `GROQ_MODEL` | Groq model choice | `llama-3.3-70b-versatile` |
| `PROACTIVE_SWEEP_CRON` | Cron schedule cho Proactive AI sweep | `0 9 * * *` |

### Development

```bash
npm install
npm run start:dev
npm run build
```
