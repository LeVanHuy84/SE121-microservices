import { Controller, Logger, Optional } from "@nestjs/common";
import { Ctx, KafkaContext, Payload } from "@nestjs/microservices";
import { AnalysisResultEvent, EventTopic } from "@repo/dtos";
import { KafkaConsumerHelper, KafkaEventPattern } from "@repo/common";
import { ConsumerService } from "./consumer.service";
import { ConsumerService as FeedConsumerService } from "../../feed/consumer/consumer.service";
import { EntityManager } from "typeorm";

@Controller("ingestion")
export class ConsumerController {
  private readonly logger = new Logger(ConsumerController.name);

  constructor(
    private readonly consumerService: ConsumerService,
    private readonly consumerHelper: KafkaConsumerHelper,
    @Optional() private readonly feedConsumerService?: FeedConsumerService,
  ) {}

  // ----------------------------
  // 🧩 POST TOPIC HANDLER (Unified Analysis Consumer)
  // ----------------------------
  @KafkaEventPattern(EventTopic.ANALYSIS_RESULT)
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
        // 1. Cập nhật nhãn cảm xúc và trạng thái kiểm duyệt bài viết trong Postgres (TypeORM)
        await this.consumerService.handleEmotionResult(
          message.payload,
          manager,
        );

        // 2. Đồng bộ Feed Snapshot và dọn Trending trong Mongo/Redis (Unified Feed Consumer)
        if (this.feedConsumerService) {
          await this.feedConsumerService.handleAnalysisResult(message);
        }
      },
    });
  }

  @KafkaEventPattern(EventTopic.TEST_FAULT)
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
