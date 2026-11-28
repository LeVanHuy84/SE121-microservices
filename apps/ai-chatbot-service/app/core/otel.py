import os
import time
from fastapi import FastAPI, Request
from prometheus_client import Counter, Histogram, start_http_server

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total number of HTTP requests",
    ["method", "route", "status"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "Duration of HTTP requests in seconds",
    ["method", "route", "status"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
)

_metrics_server_started = False


def should_enable_otel() -> bool:
    flag = os.getenv("ENABLE_OTEL", "").strip().lower()
    if flag == "true":
        return True
    if flag == "false":
        return False
    env = os.getenv("NODE_ENV", os.getenv("ENVIRONMENT", "")).strip().lower()
    return env == "production"


def register_http_metrics_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def prometheus_http_middleware(request: Request, call_next):
        if request.url.path == "/metrics":
            return await call_next(request)

        start_time = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration = time.perf_counter() - start_time
            route_obj = request.scope.get("route")
            route_path = getattr(route_obj, "path", None) or request.url.path
            try:
                HTTP_REQUESTS_TOTAL.labels(
                    method=request.method,
                    route=route_path,
                    status=str(status_code),
                ).inc()
                HTTP_REQUEST_DURATION_SECONDS.labels(
                    method=request.method,
                    route=route_path,
                    status=str(status_code),
                ).observe(duration)
            except Exception:
                pass


def init_otel(app: FastAPI, service_name: str = "ai-chatbot-service"):
    global _metrics_server_started

    register_http_metrics_middleware(app)

    # Always expose Prometheus metrics on METRICS_PORT regardless of tracing flag
    metrics_port = os.getenv("METRICS_PORT")
    if metrics_port and not _metrics_server_started:
        try:
            start_http_server(int(metrics_port), addr="0.0.0.0")
            _metrics_server_started = True
            print(
                f"[Metrics] {service_name} metrics server listening on HTTP port {metrics_port} (0.0.0.0)"
            )
        except Exception as e:
            print(f"[Metrics] Failed to start metrics server: {e}")

    if not should_enable_otel():
        return

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource

        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")

        resource = Resource.create(attributes={"service.name": service_name})
        provider = TracerProvider(resource=resource)

        processor = BatchSpanProcessor(
            OTLPSpanExporter(endpoint=endpoint, insecure=True)
        )
        provider.add_span_processor(processor)

        trace.set_tracer_provider(provider)

        FastAPIInstrumentor.instrument_app(app)
    except Exception as exc:
        print(f"[OTel] Failed to initialize OpenTelemetry: {exc}")
