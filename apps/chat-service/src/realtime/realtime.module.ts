import { Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { RedisModule } from '@repo/common';
import { MessageModule } from 'src/message/message.module';
import { ConversationModule } from 'src/conversation/conversation.module';
import { KafkaModule } from 'src/kafka/kafka.module';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Conversation,
  ConversationSchema,
} from 'src/mongo/schema/conversation.schema';
import { RealtimeController } from './realtime.controller';
import { MessageConsumerService } from './message.consumer.service';
import { Message, MessageSchema } from 'src/mongo/schema/message.schema';
import { ReceiptService } from './recepit.service';

@Module({
  imports: [
    RedisModule.forRoot({
      name: 'chat',
      config: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: +(process.env.REDIS_PORT ?? 6379),
        db: 0,
      },
    }),
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    MessageModule,
    ConversationModule,
    KafkaModule,
  ],
  providers: [RealtimeService, MessageConsumerService, ReceiptService],
  controllers: [RealtimeController],
})
export class RealtimeModule {}
