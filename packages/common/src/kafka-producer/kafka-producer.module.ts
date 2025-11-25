import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KafkaProducerService } from './kafka-producer.service';

export interface KafkaModuleOptions {
  brokers: string[];
  clientId: string;
}

@Global()
@Module({})
export class KafkaProducerModule {
  static registerAsync(): DynamicModule {
    return {
      module: KafkaProducerModule,
      imports: [ConfigModule],
      providers: [
        {
          provide: KafkaProducerService,
          useFactory: (config: ConfigService): KafkaProducerService => {
            const brokers = (
              config.get<string>('KAFKA_BROKERS') || 'localhost:9092'
            ).split(',');
            const clientId =
              config.get<string>('KAFKA_CLIENT_ID') || 'default-service';

            return new KafkaProducerService(brokers, clientId);
          },
          inject: [ConfigService],
        },
      ],
      exports: [KafkaProducerService],
    };
  }
}
