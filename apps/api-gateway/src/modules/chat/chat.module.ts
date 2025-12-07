import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';

import { Kafka, logLevel, Producer } from 'kafkajs';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ChatMessageStreamConsumer } from './chat.consumer';



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
      type: 'single',
      options: {
        host: process.env.POST_REDIS_HOST,
        port: process.env.POST_REDIS_PORT
          ? parseInt(process.env.POST_REDIS_PORT, 10)
          : 6379,
      },
    }),
  ],
  controllers: [ChatController],
  providers: [ChatGateway, ChatMessageStreamConsumer],
})
export class ChatModule {}
