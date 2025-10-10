import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KafkaProducerService } from './kafka.producer.service';
import { OutboxProcessor } from './outbox.processor';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([OutboxEvent])],
  providers: [
    {
      provide: KafkaProducerService,
      useFactory: (config: ConfigService) => {
        const brokers = (
          config.get<string>('KAFKA_BROKERS') || 'localhost:9092'
        ).split(',');
        const clientId =
          config.get<string>('KAFKA_CLIENT_ID') || 'post-service';
        return new KafkaProducerService(brokers, clientId);
      },
      inject: [ConfigService],
    },
    OutboxProcessor,
  ],
  exports: [KafkaProducerService, OutboxProcessor],
})
export class KafkaModule {}
