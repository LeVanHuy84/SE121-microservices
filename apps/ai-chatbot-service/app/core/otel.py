import os
from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource

def init_otel(app: FastAPI, service_name: str = "ai-chatbot-service"):
    enable_otel = os.getenv("ENABLE_OTEL", "false").lower() == "true"
    if not enable_otel:
        return

    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
    
    resource = Resource.create(attributes={"service.name": service_name})
    provider = TracerProvider(resource=resource)
    
    processor = BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, insecure=True))
    provider.add_span_processor(processor)
    
    trace.set_tracer_provider(provider)
    
    FastAPIInstrumentor.instrument_app(app)

