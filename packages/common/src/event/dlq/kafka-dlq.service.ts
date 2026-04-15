import { Injectable, Logger } from '@nestjs/common';
import { KafkaProducerService } from '../../kafka-producer';

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

    this.logger.warn(
      `☠️ Sent message to DLQ [${dlqTopic}] - reason: ${error?.message}`,
    );
  }
}
