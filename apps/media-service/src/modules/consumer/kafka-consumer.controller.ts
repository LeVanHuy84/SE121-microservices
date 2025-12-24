import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import * as dtos from '@repo/dtos';
import { MediaConsumerService } from './media-consumer.service';


@Controller()
export class KafkaConsumerController {
  private readonly logger = new Logger(KafkaConsumerController.name);

  constructor(private readonly mediaConsumer: MediaConsumerService) {}

  @EventPattern(dtos.EventTopic.MEDIA)
  async handleMediaEvents(@Payload() message: dtos.MediaEventMessage) {
    const { type, payload } = message;
    try {
      switch (type) {
        case dtos.MediaEventType.DELETE_REQUESTED:
          this.logger.log(
            `Media delete requested: ${payload.items.length} items`
          );
          await this.mediaConsumer.deleteMedia(payload.items);
          break;
        default:
          this.logger.warn(`Unknown MEDIA event type: ${type}`);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process MEDIA event ${type}: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }
}
