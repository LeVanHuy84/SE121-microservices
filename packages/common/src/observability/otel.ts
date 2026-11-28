import * as dotenv from 'dotenv';
import * as path from 'path';
import * as http from 'http';
import { EventEmitter } from 'events';
import { register, collectDefaultMetrics } from 'prom-client';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { context, propagation, Context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { ClientProxy } from '@nestjs/microservices';
import { Observable } from 'rxjs';

// Load environmental variables from .env file before reading process.env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Tiêm W3C Trace Context (traceparent) hiện tại vào payload gửi qua NestJS TCP
 */
export function injectTraceContext<T = any>(data: T): T {
  if (
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data) ||
    Buffer.isBuffer(data)
  ) {
    return data;
  }
  try {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    if (Object.keys(carrier).length === 0) {
      return data;
    }
    return { ...data, _traceContext: carrier };
  } catch {
    return data;
  }
}

/**
 * Trích xuất W3C Trace Context từ carrier
 */
export function extractTraceContext(carrier?: Record<string, string>): Context {
  return propagation.extract(context.active(), carrier || {});
}


export interface OTelOptions {
  collectDefaultMetrics?: boolean;
}

let metricsServerStarted = false;
let clientProxyPatched = false;

/**
 * Automatically inject W3C trace context and record client spans for all
 * NestJS ClientProxy.send() and ClientProxy.emit() calls.
 */
export function enableClientProxyTracing(): void {
  if (clientProxyPatched) {
    return;
  }
  clientProxyPatched = true;

  const origSend = ClientProxy.prototype.send;
  const origEmit = ClientProxy.prototype.emit;

  ClientProxy.prototype.send = function <TResult = any, TInput = any>(
    pattern: any,
    data: TInput,
  ): Observable<TResult> {
    const tracer = trace.getTracer('nestjs-rpc-client');
    const patternStr =
      typeof pattern === 'string' ? pattern : JSON.stringify(pattern);

    return new Observable<TResult>((subscriber) => {
      return tracer.startActiveSpan(
        `rpc.client:${patternStr}`,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            'rpc.system': 'nestjs-tcp',
            'rpc.method': patternStr,
          },
        },
        (span) => {
          const tracedData = injectTraceContext(data);
          const sub = (
            origSend.call(this, pattern, tracedData) as Observable<TResult>
          ).subscribe({
            next: (val: TResult) => subscriber.next(val),
            error: (err) => {
              span.recordException(err);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err?.message || String(err),
              });
              span.end();
              subscriber.error(err);
            },
            complete: () => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              subscriber.complete();
            },
          });
          return () => sub.unsubscribe();
        },
      );
    });
  };

  ClientProxy.prototype.emit = function <TResult = any, TInput = any>(
    pattern: any,
    data: TInput,
  ): Observable<TResult> {
    const tracer = trace.getTracer('nestjs-rpc-client');
    const patternStr =
      typeof pattern === 'string' ? pattern : JSON.stringify(pattern);

    return new Observable<TResult>((subscriber) => {
      return tracer.startActiveSpan(
        `rpc.emit:${patternStr}`,
        {
          kind: SpanKind.PRODUCER,
          attributes: {
            'rpc.system': 'nestjs-event',
            'rpc.method': patternStr,
          },
        },
        (span) => {
          const tracedData = injectTraceContext(data);
          const sub = (
            origEmit.call(this, pattern, tracedData) as Observable<TResult>
          ).subscribe({
            next: (val: TResult) => subscriber.next(val),
            error: (err) => {
              span.recordException(err);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err?.message || String(err),
              });
              span.end();
              subscriber.error(err);
            },
            complete: () => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              subscriber.complete();
            },
          });
          return () => sub.unsubscribe();
        },
      );
    });
  };
}

/**
 * Determine whether OpenTelemetry tracing should be enabled.
 * Explicit ENABLE_OTEL ('true'/'false') overrides NODE_ENV;
 * otherwise tracing is enabled by default only in production.
 */
export function shouldEnableOTel(): boolean {
  const flag = process.env.ENABLE_OTEL?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function startMetricsServer(serviceName: string, options?: OTelOptions): void {
  const metricsPort = process.env.METRICS_PORT;
  if (!metricsPort || metricsServerStarted) {
    return;
  }

  metricsServerStarted = true;

  if (options?.collectDefaultMetrics !== false) {
    try {
      collectDefaultMetrics({ register });
    } catch {
      // Silently ignore if already registered
    }
  }

  http
    .createServer(async (req, res) => {
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
    })
    .listen(parseInt(metricsPort, 10), '0.0.0.0', () => {
      console.log(
        `[Metrics] ${serviceName} metrics server listening on HTTP port ${metricsPort} (0.0.0.0)`,
      );
    });
}

export function initOTel(serviceName: string, options?: OTelOptions) {
  // Prevent Node.js MaxListenersExceededWarning when OTel instruments DB connection pools
  EventEmitter.defaultMaxListeners = 100;

  // Always expose Prometheus metrics on METRICS_PORT regardless of tracing flag
  startMetricsServer(serviceName, options);

  if (!shouldEnableOTel()) {
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
  enableClientProxyTracing();

  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => console.log('OTel shut down successfully'))
      .catch((err) => console.log('Error shutting down OTel', err))
      .finally(() => process.exit(0));
  });
}

