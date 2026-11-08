import { MessagePattern, EventPattern, Transport } from "@nestjs/microservices";
import { context, propagation, trace, SpanStatusCode } from "@opentelemetry/api";

/**
 * Decorator dành cho TCP Microservice RPC pattern (Ví dụ: send() từ API Gateway)
 * Chỉ định rõ Transport.TCP và tự động trích xuất W3C Trace Context nếu có trong payload.
 */
export function TcpMessagePattern(pattern: any): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;
    descriptor.value = async function (...args: any[]) {
      const payload = args[0];
      const carrier = payload?._traceContext;
      if (carrier && typeof carrier === 'object') {
        const parentContext = propagation.extract(context.active(), carrier);
        const tracer = trace.getTracer("nestjs-tcp");
        return context.with(parentContext, () => {
          return tracer.startActiveSpan(`tcp:${String(pattern)}`, async (span) => {
            try {
              span.setAttribute("rpc.system", "nestjs-tcp");
              span.setAttribute("rpc.service", target?.constructor?.name || "TcpService");
              span.setAttribute("rpc.method", String(pattern));
              const result = await originalMethod.apply(this, args);
              return result;
            } catch (err: any) {
              span.recordException(err);
              span.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
              throw err;
            } finally {
              span.end();
            }
          });
        });
      }
      return originalMethod.apply(this, args);
    };
    return MessagePattern(pattern, Transport.TCP)(target, propertyKey, descriptor);
  };
}

/**
 * Alias ngắn gọn cho TcpMessagePattern
 */
export const TcpPattern = TcpMessagePattern;

/**
 * Decorator dành cho TCP Microservice Event pattern (Ví dụ: emit() từ API Gateway)
 */
export function TcpEventPattern(pattern: any): MethodDecorator {
  return EventPattern(pattern, Transport.TCP);
}

/**
 * Decorator dành cho Kafka Async Event pattern
 * Chỉ định rõ Transport.KAFKA để lắng nghe đúng Kafka broker topic.
 */
export function KafkaEventPattern(pattern: any): MethodDecorator {
  return EventPattern(pattern, Transport.KAFKA);
}

/**
 * Alias ngắn gọn cho KafkaEventPattern
 */
export const KafkaPattern = KafkaEventPattern;

/**
 * Decorator dành cho Kafka Request-Reply pattern (nếu có)
 */
export function KafkaMessagePattern(pattern: any): MethodDecorator {
  return MessagePattern(pattern, Transport.KAFKA);
}

/**
 * Decorator dành cho RabbitMQ Async Event pattern
 */
export function RmqEventPattern(pattern: any): MethodDecorator {
  return EventPattern(pattern, Transport.RMQ);
}

/**
 * Alias ngắn gọn cho RmqEventPattern
 */
export const RmqPattern = RmqEventPattern;
