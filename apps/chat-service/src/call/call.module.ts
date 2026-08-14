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
import { CallTimeoutWorker } from './call-timeout.worker';

import { StreamMediaProvider } from './media/stream-media.provider';
import { PushModule } from 'src/push/push.module';
import { UserClientModule } from 'src/client/user/user-client.module';
import { RedisModule } from '@nestjs-modules/ioredis';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CallSession.name, schema: CallSessionSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    OutboxModule,
    PushModule,
    UserClientModule,
    RedisModule,
  ],
  controllers: [CallController],
  providers: [CallService, StreamMediaProvider, CallTimeoutWorker],
  exports: [CallService],
})
export class CallModule {}
