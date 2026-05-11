# Chatbot Service Alembic

## Setup

1. Install dependencies:

```bash
cd apps/chatbot-service
pip install -r requirements.txt
```

2. Ensure `.env` has `DATABASE_URL`.

## Commands

```bash
npm run db:current --workspace chatbot-service
npm run db:migrate --workspace chatbot-service
npm run db:history --workspace chatbot-service
```

Create a new migration:

```bash
npm run db:revision --workspace chatbot-service -- "your_migration_name"
```
