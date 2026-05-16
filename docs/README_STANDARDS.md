# README Standards and Implementation Plan

## Scope

This document defines the reusable README standard for the repository before any service-specific README content is written.

It applies to three documentation families:

1. Root project README for the monorepo.
2. Microservice README for every app under `apps/`.
3. Shared package README for every workspace package under `packages/`.

The standard is derived from the current repository structure, the existing architecture notes, the active OpenAPI surface, the GitHub Actions workflow scaffold, and the app/package layout.

## Repository Facts That Drive the Standard

The README structure must reflect the actual shape of this workspace:

- Monorepo orchestrated with Turborepo and npm workspaces.
- Mixed service stack: NestJS microservices, Python FastAPI services, and hybrid services that expose more than one transport.
- Communication patterns centered on HTTP, TCP, Kafka, Redis, and RabbitMQ.
- Service families include gateway, core domain services, AI assistants, recommendation/search, and shared packages.
- The repository has one active OpenAPI document for the assistant gateway flow.
- CI is scaffolded in GitHub Actions, but the workflow is currently commented and should be documented as planned or partial rather than fully implemented.
- Docker Compose is the primary visible local deployment surface in the repository.

## Documentation Rules

All README files in this repo should follow these rules:

- Start with the service or package purpose in one short paragraph.
- Describe interfaces before implementation details.
- Make communication explicit: HTTP routes, TCP message patterns, Kafka topics, RabbitMQ queues/exchanges, Redis usage, or Python endpoints.
- Include health and readiness behavior only when it exists in the service.
- Include observability only when real hooks exist; otherwise mark it as not implemented yet.
- Prefer concrete env vars, commands, ports, and dependencies over generic prose.
- Separate local development, deployment, and scaling notes into distinct sections.
- Link to authoritative docs instead of duplicating long architecture descriptions.
- Keep service-specific exceptions explicit, especially for hybrid or Python-based services.

## Root README Template

Use this structure for the root project README:

```md
# <Repository Name>

Short description of the platform and the main product goals.

## What This Monorepo Contains

- High-level service families and shared packages.
- A short explanation of the gateway, core services, AI services, and shared libraries.

## Architecture Overview

- Monorepo layout.
- Communication model across services.
- Runtime split between NestJS, Python, and hybrid services.
- Link to the main architecture report in `docs/`.

## Service Map

| Area                      | Services | Responsibilities | Primary Transports |
| ------------------------- | -------- | ---------------- | ------------------ |
| Gateway                   | ...      | ...              | ...                |
| Core domain services      | ...      | ...              | ...                |
| AI and assistant services | ...      | ...              | ...                |
| Shared packages           | ...      | ...              | ...                |

## Local Development

- Prerequisites.
- Install dependencies.
- Start infrastructure.
- Start the full stack.
- Start a selected service family.

## Environment Variables

- Global variables used across the workspace.
- Service-family variables.
- Notes on secrets and local overrides.

## Communication and Contracts

- HTTP and OpenAPI entry points.
- TCP message contracts.
- Kafka topics.
- RabbitMQ usage.
- Redis keys or channels where relevant.

## Deployment

- Docker Compose deployment.
- Terraform and Azure deployment assumptions or placeholders.
- Any production topology notes if they exist.

## CI/CD

- GitHub Actions workflow status.
- Build, lint, test, and release steps.
- What is automated now versus planned.

## Observability and Health

- Health checks and readiness endpoints.
- Logs, metrics, traces, and dashboards if they exist.

## Scaling Considerations

- Service scaling model.
- Cache usage.
- Event-driven throughput concerns.
- Background jobs or async consumers.

## Documentation Index

- Root architecture notes.
- Service README locations.
- Shared package README locations.
- OpenAPI specs.
- Operational runbooks and demo tooling.
```

### Root README Content Rules

- Use the root README as the navigation hub for the whole monorepo.
- Do not explain each microservice in depth; link to the service README instead.
- Include a single source of truth for local startup order and operational links.
- Surface the repository families that are actively maintained.
- Call out partial implementation areas clearly so readers know what is production-ready versus scaffolded.

## Microservice README Template

Use this structure for every app under `apps/`:

```md
# <Service Name>

One-paragraph purpose statement for the service.

## Responsibilities

- What the service owns.
- What it does not own.
- Which product workflows depend on it.

## Runtime Profile

| Item            | Value                                 |
| --------------- | ------------------------------------- |
| Service type    | NestJS / FastAPI / hybrid             |
| Port(s)         | ...                                   |
| Transport(s)    | HTTP / TCP / Kafka / Redis / RabbitMQ |
| Primary storage | ...                                   |
| Shared packages | ...                                   |

## Interfaces

### HTTP API

- Base path.
- OpenAPI link if available.
- Important routes and request/response notes.

### TCP / RPC

- Message patterns.
- Request/response contracts.
- Caller services.

### Events

- Consumed topics or events.
- Produced topics or events.
- Idempotency or retry notes.

### Async Infrastructure

- Redis use.
- RabbitMQ use.
- Scheduled jobs or outbox patterns.

## Dependencies

- Internal service dependencies.
- External APIs.
- Databases and storage.
- Shared packages used by the service.

## Health and Readiness

- Health endpoint or pattern.
- Readiness behavior.
- What the endpoint proves.

## Observability

- Logs.
- Metrics.
- Tracing.
- Dashboards or indexes if they exist.

## Environment Variables

- Required variables.
- Optional variables.
- Secrets.
- Local defaults or fallbacks.

## Development

- Install and run commands.
- Debug and test commands.
- Seed or replay commands if relevant.

## Docker and Deployment

- Local container notes.
- Production container notes.
- Terraform/Azure deployment hooks or placeholders.

## Scaling Considerations

- Throughput bottlenecks.
- Cache strategy.
- Queue or consumer concurrency.
- Data growth risks.

## Troubleshooting

- Common startup failures.
- Contract mismatches.
- Health check failures.
- Event or cache debugging tips.
```

### Microservice Variants

Use the same base template for all services, then add one of these variant blocks when applicable:

- NestJS core service: emphasize TCP handlers, Kafka consumers/producers, and internal service calls.
- Gateway service: emphasize HTTP routes, auth, proxying, and downstream service routing.
- Python AI service: emphasize FastAPI routes, model lifecycle, internal auth, and inference latency.
- Hybrid service: separate the README into distinct HTTP and microservice sections so each transport is documented independently.

### Microservice Content Rules

- List message patterns and event names exactly as implemented.
- Document health and readiness only if the service exposes them.
- Include observability as a factual section, even if the content is "not implemented yet".
- Include deployment notes for Docker, Terraform, and Azure only as far as the service currently supports them.
- If a service is primarily a library or internal helper, do not force a full application-style README.

## Shared Package README Template

Use this structure for every package under `packages/`:

```md
# <Package Name>

Short description of the package and who uses it.

## Purpose

- What problem the package solves.
- Which apps consume it.
- What it is not responsible for.

## Exported Surface

- Public modules, classes, functions, DTOs, or configs.
- Import examples.
- Breaking-change notes for exported contracts.

## Consumers

- Services that depend on the package.
- Whether the package is runtime, build-time, or policy-only.

## Build and Release

- Build command.
- Type-check or publish expectations.
- Workspace linking behavior.

## Compatibility Notes

- TypeScript version or compiler assumptions.
- NestJS or workspace assumptions.
- Migration notes for downstream apps.

## Examples

- Minimal usage snippet.
- Common integration pattern.
```

### Shared Package Content Rules

- For infrastructure packages such as `@repo/common`, document runtime helpers, transport helpers, and error handling support.
- For contract packages such as `@repo/dtos`, document the exported domain surface and compatibility expectations.
- For config packages, keep the README short and focused on what they extend and where they are used.
- Do not invent application behavior for packages that only provide policy or configuration.

## Repository-Specific Section Matrix

Use the following section policy when writing READMEs:

| Section                | Root README            | Microservice README    | Shared Package README |
| ---------------------- | ---------------------- | ---------------------- | --------------------- |
| Purpose                | Required               | Required               | Required              |
| Architecture overview  | Required               | Optional               | Not applicable        |
| Communication matrix   | Required               | Required               | Optional              |
| Health checks          | Required               | Required if present    | Not applicable        |
| Observability          | Required               | Required if present    | Optional              |
| Docker deployment      | Required               | Required if present    | Optional              |
| Terraform/Azure        | Required               | Required if present    | Optional              |
| CI/CD                  | Required               | Optional               | Optional              |
| Environment variables  | Required               | Required               | Optional              |
| Scaling considerations | Required               | Required               | Optional              |
| OpenAPI links          | Required if applicable | Required if applicable | Not applicable        |

## Documentation Roadmap

### Phase 1: Inventory and Canonical Map

Goal: establish the documentation source of truth before editing any README content.

Deliverables:

- Final service-family map for `apps/`.
- Final package-role map for `packages/`.
- Canonical list of docs sources, including architecture notes, OpenAPI specs, and workflow files.
- README ownership list so each workspace item has one target document.

Exit criteria:

- Every app and package has a template classification.
- Special cases are explicitly tagged as gateway, hybrid, Python AI, or config-only.

### Phase 2: Root README Rewrite

Goal: replace the starter README with the monorepo navigation hub.

Deliverables:

- Architecture overview.
- Service map.
- Local development flow.
- CI/CD and deployment summary.
- Docs index.

Exit criteria:

- A new contributor can identify the repo structure and the startup path from the root README alone.

### Phase 3: Service README Templates and Family Pass

Goal: apply the service template to each app family without writing final implementation prose yet.

Deliverables:

- Standard README skeleton for each app.
- Separate handling for gateway, core NestJS services, Python AI services, and hybrid services.
- OpenAPI-driven sections for the assistant gateway flow.

Exit criteria:

- Every app README has a consistent structure and only service-accurate sections.

### Phase 4: Shared Package README Templates

Goal: document shared libraries as first-class workspace artifacts.

Deliverables:

- README skeletons for `@repo/common`, `@repo/dtos`, `@repo/eslint-config`, and `@repo/typescript-config`.
- Export and compatibility notes for runtime packages.

Exit criteria:

- Every shared package has a clear consumer-facing README pattern.

### Phase 5: Deployment and Operations Appendices

Goal: document the operational path without overpromising unimplemented infrastructure.

Deliverables:

- Docker Compose usage guidance.
- Terraform/Azure placeholders or concrete deployment notes if they exist later.
- Health, observability, and scaling appendix for services that implement them.
- CI/CD status notes reflecting the current GitHub Actions scaffold.

Exit criteria:

- Operational docs distinguish implemented behavior from planned work.

### Phase 6: Governance and Maintenance

Goal: keep README standards stable as the repo grows.

Deliverables:

- README review checklist.
- Ownership rules for new apps and packages.
- Update policy when OpenAPI specs, workflows, or service topologies change.

Exit criteria:

- New services can be documented without redesigning the README structure.

## Suggested Maintenance Checklist

Before publishing any README update, verify:

1. The document matches the actual service or package type.
2. All listed ports, transports, and paths are real.
3. Any event, topic, or message pattern names match code exactly.
4. Health and observability sections are present only when supported.
5. Deployment and CI/CD notes do not claim automation that is not in the repo.
6. Links point to the authoritative architecture, OpenAPI, or workflow source.

## Implementation Note

This file is the documentation standard only. It intentionally does not generate final README content for any service or package yet.
