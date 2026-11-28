import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Counter, Histogram, register } from 'prom-client';

const rpcRequestsTotal =
  (register.getSingleMetric('rpc_requests_total') as Counter<string>) ||
  new Counter({
    name: 'rpc_requests_total',
    help: 'Total number of RPC/Microservice requests',
    labelNames: ['service', 'pattern', 'transport', 'status'],
  });

const rpcRequestDurationSeconds =
  (register.getSingleMetric(
    'rpc_request_duration_seconds',
  ) as Histogram<string>) ||
  new Histogram({
    name: 'rpc_request_duration_seconds',
    help: 'Duration of RPC/Microservice requests in seconds',
    labelNames: ['service', 'pattern', 'transport', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

/**
 * Global NestJS interceptor that records Prometheus count and latency
 * histograms for microservice RPC and event handlers (TCP, Kafka, RMQ, Redis).
 */
@Injectable()
export class RpcMetricsInterceptor implements NestInterceptor {
  constructor(private readonly serviceName: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const startTime = process.hrtime();
    const { pattern, transport } = this.extractMetadata(context);

    return next.handle().pipe(
      tap({
        next: () =>
          this.recordMetrics(pattern, transport, 'success', startTime),
        error: () => this.recordMetrics(pattern, transport, 'error', startTime),
      }),
    );
  }

  private extractMetadata(context: ExecutionContext): {
    pattern: string;
    transport: string;
  } {
    const rpcCtx = context.switchToRpc().getContext<Record<string, any>>();
    const ctxName = rpcCtx?.constructor?.name ?? '';
    const handlerName = context.getHandler()?.name || 'unknown';

    let transport = 'rpc';
    let pattern = handlerName;

    if (ctxName === 'KafkaContext') {
      transport = 'kafka';
      pattern = rpcCtx.getTopic?.() || handlerName;
    } else if (ctxName === 'TcpContext') {
      transport = 'tcp';
      pattern = rpcCtx.getPattern?.() || handlerName;
    } else if (ctxName === 'RmqContext') {
      transport = 'rmq';
      pattern = rpcCtx.getPattern?.() || handlerName;
    } else if (ctxName === 'RedisContext') {
      transport = 'redis';
      pattern = rpcCtx.getChannel?.() || handlerName;
    }

    return { pattern: String(pattern), transport };
  }

  private recordMetrics(
    pattern: string,
    transport: string,
    status: 'success' | 'error',
    startTime: [number, number],
  ): void {
    const diff = process.hrtime(startTime);
    const duration = diff[0] + diff[1] / 1e9;

    try {
      rpcRequestsTotal
        .labels(this.serviceName, pattern, transport, status)
        .inc();
      rpcRequestDurationSeconds
        .labels(this.serviceName, pattern, transport, status)
        .observe(duration);
    } catch {
      // Prevent metrics errors from breaking message processing
    }
  }
}
