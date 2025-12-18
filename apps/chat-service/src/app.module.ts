import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { MongoModule } from './mongo/mongo.module';
import { ConversationModule } from './conversation/conversation.module';
import { MessageModule } from './message/message.module';
import { RedisModule } from '@nestjs-modules/ioredis';
import { PresenceModule } from './presence/presence.module';
import { ChatStreamProducerService } from './chat-stream-producer/chat-stream-producer.service';
import { ChatStreamProducerModule } from './chat-stream-producer/chat-stream-producer.module';



@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
          ? parseInt(process.env.REDIS_PORT, 10)
          : 6379,
      },
    }),
    MongoModule,
    ConversationModule,
    MessageModule,
    PresenceModule,
    ChatStreamProducerModule,
  ],
  controllers: [AppController],
  providers: [AppService, ChatStreamProducerService],
})
export class AppModule {}
