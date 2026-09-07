# emotion-intelligence-service

The emotion-intelligence-service compiles user emotional profiles, aggregates dashboard data, evaluates mental health warnings, and issues AI-generated advice.

## Responsibilities

- **Dashboard Aggregation**: Summarize trends and distributions of emotions (joy, sadness, anger, fear, disgust) for users and admins.
- **Risk Evaluation**: Ingest emotion results, compute user risk baselines, and flag anomalies.
- **Support Advice**: Leverage LLM integration to generate empathetic, supportive suggestions when risk is flagged.

## Runtime Profile

| Item | Value |
| --- | --- |
| Service type | NestJS |
| Port | `PORT` or `4005` (TCP) |
| Transports | TCP, Kafka, Redis, RabbitMQ |
| Primary storage | MongoDB (Mongoose) |
| Shared packages | `@repo/common`, `@repo/dtos` |

## Environment Variables

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

## Development

```bash
npm install
npm run start:dev
npm run build
```
