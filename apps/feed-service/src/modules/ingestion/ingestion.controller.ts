import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import * as dtos from '@repo/dtos';
import { IngestionPostService } from './ingestion-post.service';
import { IngestionShareService } from './ingestion-share.service';

@Controller('ingestion')
export class IngestionController {
  constructor(
    private readonly ingestionPost: IngestionPostService,
    private readonly ingestionShare: IngestionShareService,
  ) {}
  private readonly logger = new Logger(IngestionPostService.name);

  @EventPattern('post-events')
  async handlePostEvents(@Payload() message: dtos.PostEventMessage) {
    switch (message.type) {
      case dtos.PostEventType.POST_CREATED:
        this.logger.log(`Post created: ${message.payload.postId}`);
        this.ingestionPost.handleCreated(message.payload);
        break;

      case dtos.PostEventType.POST_UPDATED:
        this.logger.log(`Post updated: ${message.payload.postId}`);
        this.ingestionPost.handleUpdated(message.payload);
        break;

      case dtos.PostEventType.REMOVE_FEED:
        this.logger.log(`Post deleted: ${message.payload.postId}`);
        this.ingestionPost.handleDeleted(message.payload);
        break;

      default:
        this.logger.warn(`Unknown post event: ${message}`);
    }
  }

  @EventPattern('share-events')
  async handleShareEvents(@Payload() message: dtos.ShareEventMessage) {
    switch (message.type) {
      case dtos.ShareEventType.SHARED_POST:
        this.logger.log(`Post shared: ${message.payload.shareId}`);
        this.ingestionShare.handleShared(message.payload);
        break;
      case dtos.ShareEventType.UPDATE_SHARE:
        this.logger.log(`Share updated: ${message.payload.shareId}`);
        this.ingestionShare.handleUpdated(message.payload);
        break;
      case dtos.ShareEventType.REMOVE_SHARE:
        this.logger.log(`Share removed: ${message.payload.shareId}`);
        this.ingestionShare.handleDeleted(message.payload);
        break;
      default:
        this.logger.warn(`Unknown share event: ${message}`);
    }
  }
}
