import { Controller, Logger } from "@nestjs/common";
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from "@nestjs/microservices";
import { EventTopic, PostGroupEventType } from "@repo/dtos";
import type { PostGroupEvent } from "@repo/dtos";
import { ConsumerService } from "../services/group-consumer.service";
import { KafkaConsumerHelper } from "@repo/common";

@Controller()
export class ConsumerController {
  private readonly logger = new Logger(ConsumerController.name);

  constructor(
    private readonly consumerService: ConsumerService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}

  @EventPattern(EventTopic.GROUP)
  async handlePostEvents(
    @Payload() message: PostGroupEvent,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();

    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    // Use handleStateless since ConsumerService now manages its own Drizzle tx
    await this.consumerHelper.handleStateless({
      topic,
      eventId,
      message,
      context,
      handler: async () => {
        const { type, payload } = message;

        switch (type) {
          case PostGroupEventType.POST_PENDING:
            this.logger.log(`Post pending: ${payload.postId}`);
            await this.consumerService.handlePending(payload);
            break;

          case PostGroupEventType.POST_APPROVED:
            this.logger.log(`Post approved: ${payload.postId}`);
            await this.consumerService.handleApproved(payload);
            break;

          case PostGroupEventType.POST_REJECTED:
            this.logger.log(`Post rejected: ${payload.postId}`);
            await this.consumerService.handleRejected(payload);
            break;

          default:
            this.logger.warn(`Unknown POST event type: ${type}`);
            break;
        }
      },
    });
  }
}
