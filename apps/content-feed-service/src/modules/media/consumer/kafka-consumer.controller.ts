import { Controller, Logger } from "@nestjs/common";
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from "@nestjs/microservices";
import * as dtos from "@repo/dtos";
import { MediaConsumerService } from "./media-consumer.service";
import { KafkaConsumerHelper } from "@repo/common";
import { EntityManager } from "typeorm";

@Controller()
export class KafkaConsumerController {
  private readonly logger = new Logger(KafkaConsumerController.name);

  constructor(
    private readonly mediaConsumer: MediaConsumerService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}

  @EventPattern(dtos.EventTopic.MEDIA)
  async handleMediaEvents(
    @Payload() message: dtos.MediaEventMessage,
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
        const { type, payload } = message;

        switch (type) {
          case dtos.MediaEventType.DELETE_REQUESTED:
            this.logger.log(
              `Media delete requested: ${payload.items.length} items`,
            );
            await this.mediaConsumer.deleteMedia(payload.items, manager);
            break;

          case dtos.MediaEventType.CONTENT_ID_ASSIGNED:
            this.logger.log(
              `Media contentId assigned: ${payload.items.length} items`,
            );
            await this.mediaConsumer.assignContentId(
              payload.contentId,
              payload.items,
              manager, // 👈 truyền manager nếu service hỗ trợ
            );
            break;

          default:
            this.logger.warn(`Unknown MEDIA event type: ${type}`);
            break;
        }
      },
    });
  }
}
