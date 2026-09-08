import { Controller, Logger } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import { AnalysisEventType, AnalysisResultEvent, EventTopic, ModerationRejectedEvent } from '@repo/dtos';
import { KafkaConsumerHelper } from '@repo/common';
import { ClientSession } from 'mongoose';

@Controller('ingestion')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}

  // ----------------------------
  // ANALYSIS RESULT TOPIC
  // ----------------------------
  @EventPattern(EventTopic.EMOTION_RESULT)
  async handleAnalysisEvents(
    @Payload() message: AnalysisResultEvent,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();

    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handle({
      topic,
      eventId,
      message,
      context,
      handler: async (_session: ClientSession) => {
        const { type, payload } = message;

        this.logger.debug(
          `Received event ${type} for target ${payload.targetId}`,
        );

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
      },
    });
  }

  // ----------------------------
  // MODERATION REJECTED TOPIC
  // ----------------------------
  @EventPattern(EventTopic.MODERATION_REJECTED)
  async handleModerationEvents(
    @Payload() message: ModerationRejectedEvent,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();

    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handle({
      topic,
      eventId,
      message,
      context,
      handler: async (_session: ClientSession) => {
        const payload = message.payload;
        this.logger.debug(
          `Received moderation event for target ${payload?.targetId}, action=${payload?.action}`,
        );

        if (payload) {
          await this.ingestionService.handleModeration(payload);
        }
      },
    });
  }
}
