import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import * as dtos from '@repo/dtos';
import { IngestionPostService } from './ingestion-post.service';
import { IngestionShareService } from './ingestion-share.service';
import { StatsIngestionService } from './ingestion-stats.service';

@Controller('ingestion')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(
    private readonly ingestionPost: IngestionPostService,
    private readonly ingestionShare: IngestionShareService,
    private readonly ingestionStats: StatsIngestionService,
  ) {}

  // ----------------------------
  // 🧩 POST TOPIC HANDLER
  // ----------------------------
  @EventPattern(dtos.EventTopic.POST)
  async handlePostEvents(@Payload() message: dtos.PostEventMessage) {
    const { type, payload } = message;

    try {
      switch (type) {
        case dtos.PostEventType.CREATED:
          this.logger.log(`Post created: ${payload.postId}`);
          await this.ingestionPost.handleCreated(payload);
          break;

        case dtos.PostEventType.UPDATED:
          this.logger.log(`Post updated: ${payload.postId}`);
          await this.ingestionPost.handleUpdated(payload);
          break;

        case dtos.PostEventType.REMOVED:
          this.logger.log(`Post removed: ${payload.postId}`);
          await this.ingestionPost.handleRemoved(payload);
          break;

        default:
          this.logger.warn(`Unknown POST event type: ${type}`);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process POST event ${type} for ${payload.postId}: ${error.message}`,
        error.stack,
      );
      throw error; // để Kafka retry lại
    }
  }

  // ----------------------------
  // 🔁 SHARE TOPIC HANDLER
  // ----------------------------
  @EventPattern(dtos.EventTopic.SHARE)
  async handleShareEvents(@Payload() message: dtos.ShareEventMessage) {
    const { type, payload } = message;

    try {
      switch (type) {
        case dtos.ShareEventType.CREATED:
          this.logger.log(`Share created: ${payload.shareId}`);
          await this.ingestionShare.handleCreated(payload);
          break;

        case dtos.ShareEventType.UPDATED:
          this.logger.log(`Share updated: ${payload.shareId}`);
          await this.ingestionShare.handleUpdated(payload);
          break;

        case dtos.ShareEventType.REMOVED:
          this.logger.log(`Share removed: ${payload.shareId}`);
          await this.ingestionShare.handleRemoved(payload);
          break;

        default:
          this.logger.warn(`Unknown SHARE event type: ${type}`);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process SHARE event ${type} for ${payload.shareId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  // ----------------------------
  // 📊 STATS TOPIC HANDLER
  // ----------------------------
  @EventPattern(dtos.EventTopic.STATS)
  async handleStatsEvents(@Payload() message: dtos.StatsEvent) {
    try {
      await this.ingestionStats.processStatsBatch(message.payload);
      this.logger.log(`Processed stats batch at ${message.payload.timestamp}`);
    } catch (error) {
      this.logger.error(
        `Failed to process STATS batch at ${message.payload.timestamp}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
