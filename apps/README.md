# Apps

## Overview
Core microservices and ingress gateway comprising the Sentimeta distributed backend architecture.

## Subdirectories & Boundaries
- [api-gateway](./api-gateway/README.md) - Public API ingress proxy (`:4000`), Clerk authentication, Svix webhooks, and real-time Socket.IO chat/presence namespace.
- [ai-chatbot-service](./ai-chatbot-service/README.md) - FastAPI Python service (`:4006`) hosting multimodal emotion models (PhoBERT, CLIP/FER), safety guardrails, and RAG mental health chatbot assistant with multi-session memory architecture v2.
- [chat-service](./chat-service/README.md) - NestJS TCP service (`:4004`) managing private/group conversations, message history, user presence, and Stream video call sessions.
- [content-feed-service](./content-feed-service/README.md) - NestJS TCP service (`:4002`) for post lifecycle, comments, reactions, personalized Redis ZSET feed ranking, Cloudinary media, and RabbitMQ notifications.
- [emotion-intelligence-service](./emotion-intelligence-service/README.md) - NestJS TCP service (`:4005`) aggregating emotional health dashboards, risk baseline anomalies, and proactive AI wellbeing sweeps.
- [search-recommendation-service](./search-recommendation-service/README.md) - NestJS TCP service (`:4003`) executing Elasticsearch full-text queries, pgvector profile recommendation embeddings, and mood-adaptive music recommendations.
- [user-social-service](./user-social-service/README.md) - NestJS TCP service (`:4001`) managing user identities, Clerk synchronization, follower/friendship social graph, and community groups via PostgreSQL (Drizzle ORM).
