import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FriendshipModule } from './friendship/friendship.module';
import { NotificationModule } from './event/rabbitmq/notification.module';
import { EventModule } from './event/event.module';
import { UserClientModule } from './client/user/user-client.module';
import { PostgresModule } from './postgres/postgres.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PostgresModule,
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
          ? parseInt(process.env.REDIS_PORT, 10)
          : 6379,
      },
    }),
    ScheduleModule.forRoot(),
    FriendshipModule,
    NotificationModule,
    EventModule,
    UserClientModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
