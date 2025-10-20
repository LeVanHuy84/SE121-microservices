import { Module, Global, DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KafkaService } from './kafka.service';

@Global()
@Module({})
export class KafkaModule {
  static register(clientId: string, name = 'KAFKA_CLIENT'): DynamicModule {
    return {
      module: KafkaModule,
      imports: [
        ConfigModule,
        ClientsModule.registerAsync([
          {
            name,
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              transport: Transport.KAFKA,
              options: {
                client: {
                  clientId,
                  brokers: (
                    config.get<string>('KAFKA_BROKERS') || 'localhost:9092'
                  ).split(',') as string[],
                },
                producerOnlyMode: true,
              },
            }),
          },
        ]),
      ],
      providers: [KafkaService],
      exports: [ClientsModule, KafkaService],
    };
  }
}

