import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatStreamProducerModule } from 'src/chat-stream-producer/chat-stream-producer.module';
import { OutboxEvent, OutboxEventSchema } from 'src/mongo/schema/outbox.schema';
import { OutboxProcessor } from './outbox.processor';
import { OutboxService } from './outbox.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OutboxEvent.name, schema: OutboxEventSchema },
    ]),
    ChatStreamProducerModule,
  ],
  providers: [OutboxService, OutboxProcessor],
  exports: [OutboxService],
})
export class OutboxModule {}
