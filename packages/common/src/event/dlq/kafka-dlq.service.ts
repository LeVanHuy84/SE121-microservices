import { Injectable, Logger } from '@nestjs/common';
import { Counter, register } from 'prom-client';
import { KafkaProducerService } from '../../kafka-producer';

const kafkaDlqMessagesTotal =
  (register.getSingleMetric('kafka_dlq_messages_total') as Counter<string>) ||
  new Counter({
    name: 'kafka_dlq_messages_total',
    help: 'Total number of messages sent to Kafka Dead Letter Queue',
    labelNames: ['topic'],
  });

@Injectable()
export class KafkaDLQService {
  private readonly logger = new Logger(KafkaDLQService.name);

  constructor(private readonly producer: KafkaProducerService) {}

  async send(
    topic: string,
    message: any,
    error: any,
    metadata?: Record<string, any>,
  ) {
    const dlqTopic = `${topic}.DLQ`;

    const payload = {
      originalTopic: topic,
      message,
      error: {
        message: error?.message,
        stack: error?.stack,
      },
      metadata: metadata || {},
      failedAt: new Date().toISOString(),
    };

    await this.producer.sendMessage(dlqTopic, payload);
    try {
      kafkaDlqMessagesTotal.labels(topic).inc();
    } catch {
      // Prevent metrics errors from breaking DLQ logging
    }

    this.logger.warn(
      `☠️ Sent message to DLQ [${dlqTopic}] - reason: ${error?.message}`,
    );
  }
}
