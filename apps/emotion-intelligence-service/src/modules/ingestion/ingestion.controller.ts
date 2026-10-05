import { Controller, Logger } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import { AnalysisEventType, AnalysisResultEvent, EventTopic, ChatbotCrisisAlertEvent } from '@repo/dtos';
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
  @EventPattern(EventTopic.ANALYSIS_RESULT)
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

        await this.ingestionService.handleAnalysisResult(payload);
      },
    });
  }

  // ----------------------------
  // CHATBOT CRISIS ALERT TOPIC
  // ----------------------------
  @EventPattern(EventTopic.CHATBOT_CRISIS_ALERT)
  async handleChatbotCrisisAlert(
    @Payload() message: ChatbotCrisisAlertEvent,
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
        const { payload } = message;
        this.logger.debug(`Received chatbot crisis alert for user ${payload.userId}`);
        await this.ingestionService.handleChatbotCrisisAlert(payload);
      },
    });
  }
}
