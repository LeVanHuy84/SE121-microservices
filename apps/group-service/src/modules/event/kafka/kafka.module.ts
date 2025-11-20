import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from './kafka.producer.service';

@Global()
@Module({
  providers: [
    {
      provide: KafkaProducerService,
      useFactory: (config: ConfigService) => {
        const brokers = (
          config.get<string>('KAFKA_BROKERS') || 'localhost:9092'
        ).split(',');
        const clientId =
          config.get<string>('KAFKA_CLIENT_ID') || 'group-service';
        return new KafkaProducerService(brokers, clientId);
      },
      inject: [ConfigService],
    },
  ],
  exports: [KafkaProducerService],
})
export class KafkaModule {}
