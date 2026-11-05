import { MessagePattern, EventPattern, Transport } from "@nestjs/microservices";

/**
 * Decorator dành cho TCP Microservice RPC pattern (Ví dụ: send() từ API Gateway)
 * Chỉ định rõ Transport.TCP để tránh NestJS Kafka server tự động biến pattern này thành Kafka topic.
 */
export function TcpMessagePattern(pattern: any): MethodDecorator {
  return MessagePattern(pattern, Transport.TCP);
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
