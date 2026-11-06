import { Controller, Logger } from "@nestjs/common";
import { Payload, Ctx, KafkaContext } from "@nestjs/microservices";
import { EventTopic } from "@repo/dtos";
import { ConsumerService } from "./consumer.service";
import { KafkaConsumerHelper, KafkaEventPattern } from "@repo/common";
import { ClientSession } from "mongoose";

@Controller("consumer")
export class ConsumerController {
  private readonly logger = new Logger(ConsumerController.name);

  constructor(
    private readonly consumerService: ConsumerService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}

  // Ghi chú kiến trúc: Handler ANALYSIS_RESULT đã được hợp nhất về PostConsumerController
  // để xử lý tuần tự/song song cả TypeORM Post Moderation và Mongoose Feed Snapshot,
  // loại bỏ hoàn toàn xung đột Kafka Event Pattern giữa 2 module.

  // ----------------------------
  // INTERACTION TOPIC
  // ----------------------------
  @KafkaEventPattern(EventTopic.INTERACTION)
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
