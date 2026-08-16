import * as dotenv from 'dotenv';
import * as path from 'path';
import * as http from 'http';
import { register, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// Load environmental variables from .env file before reading process.env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });


export interface OTelOptions {
  collectDefaultMetrics?: boolean;
}

export function initOTel(serviceName: string, options?: OTelOptions) {
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

  // Spin up a lightweight metrics HTTP server on METRICS_PORT if specified
  const metricsPort = process.env.METRICS_PORT;
  if (metricsPort) {
    if (options?.collectDefaultMetrics !== false) {
      try {
        collectDefaultMetrics({ register });
      } catch (err) {
        // Silently ignore if already registered
      }
    }

    http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        try {
          res.writeHead(200, { 'Content-Type': register.contentType });
          res.end(await register.metrics());
        } catch (err) {
          res.writeHead(500);
          res.end(String(err));
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    }).listen(parseInt(metricsPort, 10), '0.0.0.0', () => {
      console.log(`[Metrics] ${serviceName} metrics server listening on HTTP port ${metricsPort} (0.0.0.0)`);
    });
  }

  process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(() => console.log('OTel shut down successfully'))
      .catch((err) => console.log('Error shutting down OTel', err))
      .finally(() => process.exit(0));
  });
}

