import { Controller, Logger } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { EventPattern, Payload } from '@nestjs/microservices';
import { AnalysisEventType, AnalysisResultEvent, EventTopic } from '@repo/dtos';

@Controller('ingestion')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(private readonly ingestionService: IngestionService) {}

  // ----------------------------
  // 🧩 POST TOPIC HANDLER
  // ----------------------------
  @EventPattern(EventTopic.EMOTION_RESULT)
  async handleAnalysisEvents(@Payload() message: AnalysisResultEvent) {
    const { type, payload } = message;
    this.logger.debug(`Received event ${type} for target ${payload.targetId}`);

    try {
      switch (type) {
        case AnalysisEventType.CREATED:
          await this.ingestionService.handleCreated(payload);
          break;

        case AnalysisEventType.UPDATED:
          await this.ingestionService.handleUpdated(payload);
          break;
        default:
          this.logger.warn(`Unknown event type: ${type}`);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process event ${type} for ${payload.targetId}: ${error.message}`,
        error.stack,
      );
      throw error; // để Kafka retry lại
    }
  }
}
