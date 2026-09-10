import { Controller, Logger } from "@nestjs/common";
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
} from "@nestjs/microservices";
import { AnalysisResultEvent, EventTopic } from "@repo/dtos";
import { KafkaConsumerHelper } from "@repo/common";
import { ConsumerService } from "./consumer.service";
import { EntityManager } from "typeorm";

@Controller("ingestion")
export class ConsumerController {
  private readonly logger = new Logger(ConsumerController.name);

  constructor(
    private readonly consumerService: ConsumerService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}

  // ----------------------------
  // 🧩 POST TOPIC HANDLER
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

    await this.consumerHelper.handleWithTypeOrm({
      topic,
      eventId,
      message,
      context,
      handler: async (manager: EntityManager) => {
        await this.consumerService.handleEmotionResult(
          message.payload,
          manager,
        );
      },
    });
  }

  @EventPattern(EventTopic.TEST_FAULT)
  async handleTestFault(@Payload() message: any, @Ctx() context: KafkaContext) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();

    const eventId =
      message.eventId ||
      raw.key?.toString() ||
      `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handleWithTypeOrm({
      topic,
      eventId,
      message,
      context,
      handler: async (manager: EntityManager) => {
        // 🔥 Giả lập lỗi để test retry + DLQ
        this.logger.debug(`🔥 TEST_SUCCESS triggered with eventId=${eventId}`);
      },
    });
  }
}
