import { Controller, Logger } from '@nestjs/common';
import { ConsumerService } from './consumer.service';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import { EventTopic } from '@repo/dtos';
import { KafkaConsumerHelper } from '@repo/common';
import { ClientSession } from 'mongoose';

@Controller()
export class ConsumerController {
  private readonly logger = new Logger(ConsumerController.name);

  constructor(
    private readonly consumerService: ConsumerService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}

  @EventPattern(EventTopic.LOGGING)
  async handlePostEvents(
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
        const { type, payload } = message;

        await this.consumerService.createAuditLog(type, payload, _session);

        this.logger.log(
          `Processed LOGGING event ${type} for ${payload.postId}`,
        );
      },
    });
  }
}
