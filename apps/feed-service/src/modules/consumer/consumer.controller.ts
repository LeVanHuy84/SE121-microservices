import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { AnalysisEventType, AnalysisResultEvent, EventTopic } from '@repo/dtos';
import { ConsumerService } from './consumer.service';

@Controller('consumer')
export class ConsumerController {
  private readonly logger = new Logger(ConsumerController.name);

  constructor(private readonly consumerService: ConsumerService) {}

  // ----------------------------
  // 🧩 POST TOPIC HANDLER
  // ----------------------------
  @EventPattern(EventTopic.ANALYSIS_RESULT)
  async handleAnalysisEvents(@Payload() message: AnalysisResultEvent) {
    const { type, payload } = message;

    try {
      switch (type) {
        case AnalysisEventType.CREATED:
          await this.consumerService.handleCreated(payload);
          break;

        case AnalysisEventType.UPDATED:
          await this.consumerService.handleUpdated(payload);
          break;
        default:
          this.logger.warn(`Unknown event type: ${type}`);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process POST event ${type} for ${payload.targetId}: ${error.message}`,
        error.stack,
      );
      throw error; // để Kafka retry lại
    }
  }
}
