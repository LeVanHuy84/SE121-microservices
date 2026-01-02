import { Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from 'src/mongo/schema/message.schema';
import { MessageCacheService } from './message-cache.service';
import {
  Conversation,
  ConversationSchema,
} from 'src/mongo/schema/conversation.schema';
import { ConversationModule } from 'src/conversation/conversation.module';
import { ChatStreamProducerService } from 'src/chat-stream-producer/chat-stream-producer.service';
import { OutboxModule } from 'src/outbox/outbox.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
    ]),
    ConversationModule,
    OutboxModule,
  ],
  controllers: [MessageController],
  providers: [MessageService, MessageCacheService, ChatStreamProducerService],
  exports: [MessageService],
})
export class MessageModule {}
