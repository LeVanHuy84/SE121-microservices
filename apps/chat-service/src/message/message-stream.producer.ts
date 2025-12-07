import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { MessageResponseDTO } from '@repo/dtos';

@Injectable()
export class MessageStreamProducer {
  private readonly logger = new Logger(MessageStreamProducer.name);
  private readonly streamKey = 'chat:messages';

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async publishMessageCreated(msg: MessageResponseDTO) {
    try {
      await this.redis.xadd(
        this.streamKey,
        '*', // auto id
        'event',
        'message.created',
        'payload',
        JSON.stringify(msg),
      );
      this.logger.debug(`Published message.created to ${this.streamKey}`);
    } catch (e) {
      this.logger.error('Failed to XADD chat:messages', e);
    }
  }

  async publishMessageDeleted(msg: MessageResponseDTO) {
    try {
      await this.redis.xadd(
        this.streamKey,
        '*',
        'event',
        'message.deleted',
        'payload',
        JSON.stringify(msg),
      );
    } catch (e) {
      this.logger.error('Failed to XADD chat:messages (deleted)', e);
    }
  }
}
