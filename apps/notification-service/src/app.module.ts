import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongoModule } from './mongo/mongo.module';
import { NotificationModule } from './notification/notification.module';
import { UserPreferenceModule } from './user-preference/user-preference.module';
import { RedisModule } from '@nestjs-modules/ioredis';
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
    NotificationModule,
    MongoModule,
    UserPreferenceModule,
  ],
})
export class AppModule {}
