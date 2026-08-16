import * as dotenv from 'dotenv';
import * as path from 'path';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// Load environmental variables from .env file before reading process.env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });


export function initOTel(serviceName: string) {
  if (process.env.ENABLE_OTEL !== 'true') {
    return;
  }

  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Turn off fs and net instrumentation to improve performance and prevent too many spans
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-net': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('OTel shut down successfully'))
      .catch((err) => console.log('Error shutting down OTel', err))
      .finally(() => process.exit(0));
  });
}

