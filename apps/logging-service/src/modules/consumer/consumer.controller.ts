import { Controller, Logger } from '@nestjs/common';
import { ConsumerService } from './consumer.service';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EventTopic } from '@repo/dtos';

@Controller()
export class ConsumerController {
  constructor(private readonly consumerService: ConsumerService) {}
  private readonly logger = new Logger(ConsumerController.name);

  @EventPattern(EventTopic.LOGGING)
  async handlePostEvents(@Payload() message: any) {
    const { type, payload } = message;

    try {
      await this.consumerService.createAuditLog(type, payload);
      this.logger.log(`Processed POST event ${type} for ${payload.postId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process POST event ${type} for ${payload.postId}: ${error.message}`,
        error.stack,
      );
      throw error; // để Kafka retry lại
    }
  }
}
