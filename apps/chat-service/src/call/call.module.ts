import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CallController } from './call.controller';
import { CallService } from './call.service';
import {
  CallSession,
  CallSessionSchema,
} from 'src/mongo/schema/call-session.schema';
import {
  Conversation,
  ConversationSchema,
} from 'src/mongo/schema/conversation.schema';
import { Message, MessageSchema } from 'src/mongo/schema/message.schema';
import { OutboxModule } from 'src/outbox/outbox.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CallSession.name, schema: CallSessionSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    OutboxModule,
  ],
  controllers: [CallController],
  providers: [CallService],
  exports: [CallService],
})
export class CallModule {}
