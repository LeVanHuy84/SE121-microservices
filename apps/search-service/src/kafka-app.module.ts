import { Module } from '@nestjs/common';
import { ElasticsearchModule } from './elastic/elastic.module';
import { KafkaConsumerModule } from './modules/consumer/kafka-consumer.module';

@Module({
  imports: [ElasticsearchModule, KafkaConsumerModule],
})
export class KafkaAppModule {}
