import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { ConversationController } from './conversation.controller';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Conversation,
  ConversationSchema,
} from 'src/mongo/schema/conversation.schema';
import { ConversationCacheService } from './conversation-cache.service';
import { Message, MessageSchema } from 'src/mongo/schema/message.schema';
import { ChatStreamProducerService } from 'src/chat-stream-producer/chat-stream-producer.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [ConversationController],
  providers: [ConversationService, ConversationCacheService, ChatStreamProducerService],
  exports: [ConversationService],
})
export class ConversationModule {}
