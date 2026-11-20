# Seed Data

## Overview
Database population scripts, synthetic user generators, Clerk mock profiles, and initial test datasets for local development and integration testing across Sentimeta microservices.

## Interface
- **Clerk Seeds** (`./clerk`): Automated scripts creating test Clerk user accounts, synchronizing credentials, and generating social mock graphs.
- **Microservice Seeds** (`./seeds`): Dedicated population scripts for `chat-service`, `content-feed-service`, `group-service`, `emotion-intelligence-service`, and `search-recommendation-service`.
- **Raw Data Assets** (`./data`): Static JSON/CSV fixtures for music catalogs, sample posts, and sentiment text samples.

## Invariants
- Seed scripts must verify existing database connection strings from `.env.production.local` or environment variables before executing mutations.
- User IDs must cross-reference valid Clerk user IDs created via `npm run seed:clerk`.

## Side Effects
- Mutates records in MongoDB, PostgreSQL, and Elasticsearch.
- Makes outbound requests to Clerk API to provision test accounts.

## Verification
- Run: `npm run seed:clerk -- --dry-run` or verify with `npm run check-types`
