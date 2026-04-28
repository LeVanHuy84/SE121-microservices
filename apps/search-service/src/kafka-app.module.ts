import { Module } from '@nestjs/common';
import { ElasticsearchModule } from './elastic/elastic.module';
import { KafkaConsumerModule } from './modules/consumer/kafka-consumer.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    ElasticsearchModule,
    KafkaConsumerModule,
  ],
})
export class KafkaAppModule {}
