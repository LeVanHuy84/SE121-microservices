// apps/gateway/src/chat/chat-message-stream.consumer.ts
import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { ChatGateway } from './chat.gateway';
import { MessageResponseDTO } from '@repo/dtos';

@Injectable()
export class ChatMessageStreamConsumer
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChatMessageStreamConsumer.name);
  private readonly streamKey = 'chat:messages';
  private running = true;
  private lastId = '$';

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly chatGateway: ChatGateway
  ) {}

  async onModuleInit() {
    this.logger.log(`Starting ChatMessageStreamConsumer on ${this.streamKey}`);
    this.consumeLoop();
  }

  async onModuleDestroy() {
    this.running = false;
  }

  private async consumeLoop() {
    while (this.running) {
      try {
        const res = await this.redis.xread(
          'BLOCK',
          5000,
          'STREAMS',
          this.streamKey,
          this.lastId
        );

        if (!res) continue;

        for (const [, entries] of res) {
          for (const [id, fields] of entries as any) {
            this.lastId = id;

            const obj: Record<string, string> = {};
            for (let i = 0; i < fields.length; i += 2) {
              obj[fields[i]] = fields[i + 1];
            }

            const event = obj.event;
            const payload = obj.payload;

            if (!event || !payload) continue;

            try {
              const msg: MessageResponseDTO = JSON.parse(payload);

              if (event === 'message.created') {
                this.chatGateway.broadcastNewMessage(msg);
              } else if (event === 'message.deleted') {
                this.chatGateway.broadcastMessageDeleted(msg);
              }
            } catch (e) {
              this.logger.error('Failed to parse payload from stream', e);
            }
          }
        }
      } catch (e) {
        this.logger.error('Error in chat messages consumeLoop', e);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}
