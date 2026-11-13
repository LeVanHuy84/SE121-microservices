# Infrastructure

## Overview
Deployment definitions, observability stack configurations (Prometheus, Grafana, Promtail, Loki), and containerized telemetry pipelines monitoring the SE121 microservices platform.

## Interface
- **Grafana** (`./grafana`): Provisioned dashboards and datasource configurations for microservices performance and request metrics.
- **Prometheus** (`./prometheus`): Metrics scrape configurations targeting NestJS and Python service health and OpenTelemetry endpoints.
- **Promtail** (`./promtail`): Log shipping configurations forwarding Docker and container stdout/stderr streams to Loki.

## Invariants
- Prometheus scrape targets must align with container port mappings defined in `docker-compose.yml`.
- Grafana dashboard configurations must use declarative provisioning files under `./grafana/provisioning`.

## Side Effects
- Collects and aggregates real-time CPU, memory, latency, and throughput metrics across all running backend containers.
- Tails and indexes distributed container logs.

## Verification
- Run: `docker compose config`
