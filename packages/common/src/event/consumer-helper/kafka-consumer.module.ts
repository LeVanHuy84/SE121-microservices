import { Module } from '@nestjs/common';
import { KafkaConsumerHelper } from './kafka-consumer.helper';

@Module({
  providers: [KafkaConsumerHelper],
  exports: [KafkaConsumerHelper],
})
export class KafkaConsumerModule {}
