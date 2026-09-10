import { Controller, Logger } from "@nestjs/common";
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from "@nestjs/microservices";
import { AnalysisEventType, AnalysisResultEvent, EventTopic } from "@repo/dtos";
import { ConsumerService } from "./consumer.service";
import { KafkaConsumerHelper } from "@repo/common";
import { ClientSession } from "mongoose";

@Controller("consumer")
export class ConsumerController {
  private readonly logger = new Logger(ConsumerController.name);

  constructor(
    private readonly consumerService: ConsumerService,
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
      },
    });
  }

  // ----------------------------
  // INTERACTION TOPIC
  // ----------------------------
  @EventPattern(EventTopic.INTERACTION)
  async handleInteractionEvents(
    @Payload() message: any,
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

        this.logger.debug(
          `Processing INTERACTION for target ${payload.targetId}`,
        );

        await this.consumerService.handleInteraction(payload);
      },
    });
  }
}
