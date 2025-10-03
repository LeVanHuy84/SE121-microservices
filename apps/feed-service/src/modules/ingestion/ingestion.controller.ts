import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import * as dtos from '@repo/dtos';
import { IngestionService } from './ingestion.service';

@Controller('ingestion')
export class IngestionController {
  constructor(private ingestionService: IngestionService) {}
  private readonly logger = new Logger(IngestionService.name);

  @EventPattern('post-events')
  async handlePostEvents(@Payload() message: dtos.PostEventMessage) {
    switch (message.type) {
      case dtos.PostEventType.POST_CREATED:
        this.logger.log(`Post created: ${message.payload.postId}`);
        this.ingestionService.handleCreated(message.payload);
        break;

      case dtos.PostEventType.POST_UPDATED:
        this.logger.log(`Post updated: ${message.payload.postId}`);
        this.ingestionService.handleUpdated(message.payload);
        break;

      case dtos.PostEventType.REMOVE_FEED:
        this.logger.log(`Post deleted: ${message.payload.postId}`);
        this.ingestionService.handleDeleted(message.payload);
        break;

      default:
        this.logger.warn(`Unknown post event: ${message}`);
    }
  }
}
