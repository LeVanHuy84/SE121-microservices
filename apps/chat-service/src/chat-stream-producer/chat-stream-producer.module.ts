import { Module } from '@nestjs/common';
import { ChatStreamProducerService } from './chat-stream-producer.service';

@Module({
  providers: [
    ChatStreamProducerService
  ],
  exports: [ChatStreamProducerService],
})
export class ChatStreamProducerModule {}
