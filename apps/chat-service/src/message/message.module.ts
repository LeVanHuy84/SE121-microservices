import { Module } from '@nestjs/common';
import { MessageService } from './message.service';
import { MessageController } from './message.controller';
import { MongooseModule } from '@nestjs/mongoose';
import { Message, MessageSchema } from 'src/mongo/schema/message.schema';
import { MessageCacheService } from './message-cache.service';
import { Conversation, ConversationSchema } from 'src/mongo/schema/conversation.schema';
import { ConversationModule } from 'src/conversation/conversation.module';
import { MessageStreamProducer } from './message-stream.producer';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
    ]),
    ConversationModule,
  ],
  controllers: [MessageController],
  providers: [MessageService, MessageCacheService, MessageStreamProducer],
  exports: [MessageService],
})
export class MessageModule {}
