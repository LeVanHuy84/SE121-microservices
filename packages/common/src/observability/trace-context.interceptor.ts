import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { context as otelContext, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { extractTraceContext } from './otel';

/**
 * Global NestJS interceptor for microservice handlers (TCP, Kafka, RMQ, Redis).
 * Extracts W3C trace context from `_traceContext` on incoming payloads,
 * strips `_traceContext` before validation/business logic, and executes the
 * handler inside an active OpenTelemetry SERVER span.
 */
@Injectable()
export class TraceContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const rpc = context.switchToRpc();
    const data = rpc.getData<Record<string, unknown>>();

    let parentCtx = otelContext.active();
    if (
      data &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      !Buffer.isBuffer(data) &&
      data._traceContext &&
      typeof data._traceContext === 'object'
    ) {
      parentCtx = extractTraceContext(
        data._traceContext as Record<string, string>,
      );
      delete data._traceContext;
    }

    const { pattern, transport } = this.extractMetadata(context);

    return new Observable((subscriber) => {
      return otelContext.with(parentCtx, () => {
        const tracer = trace.getTracer('nestjs-rpc-server');
        return tracer.startActiveSpan(
          `${transport}:${pattern}`,
          {
            kind: SpanKind.SERVER,
            attributes: {
              'rpc.system': transport,
              'rpc.method': pattern,
            },
          },
          (span) => {
            const sub = next.handle().subscribe({
              next: (val) => subscriber.next(val),
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
    });
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
}
