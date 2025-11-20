import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { RedisModule } from '@repo/common';
import { Kafka, logLevel, Producer } from 'kafkajs';


export const KAFKA = {
  CLIENT: 'KAFKA_CLIENT',
  PRODUCER: 'KAFKA_PRODUCER',
  CONSUMER_FACTORY: 'KAFKA_CONSUMER_FACTORY',
};
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.CHAT_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('CHAT_SERVICE_PORT'),
          },
        }),
      },
    ]),
    RedisModule.forRoot({
      name: 'chat_gateway',
      config: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: +(process.env.REDIS_PORT ?? 6379),
        db: 0,
      },
    }),
  ],
  controllers: [ChatController],
  providers: [
    ChatGateway,
    {
      provide: KAFKA.CLIENT,
      useFactory: () => {
        const brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(
          ','
        );
        const clientId = process.env.KAFKA_CLIENT_ID || 'gateway-chat';
        return new Kafka({
          clientId,
          brokers,
          connectionTimeout: 5000,
          requestTimeout: 30000,
          logLevel: logLevel.ERROR,
          // add ssl/sasl here if needed
        });
      },
    },
    {
      provide: KAFKA.PRODUCER,
      inject: [KAFKA.CLIENT],
      useFactory: async (kafka: Kafka) => {
        const producer: Producer = kafka.producer({
          idempotent: true,
          maxInFlightRequests: 1,
          retry: { retries: 8, initialRetryTime: 300 },
        });
        await producer.connect();
        return producer;
      },
    },
  ],
  exports: [
    KAFKA.CLIENT,
    KAFKA.PRODUCER,
  ]
},
)
export class ChatModule {}
