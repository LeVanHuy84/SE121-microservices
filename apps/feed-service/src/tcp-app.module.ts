import { Module } from '@nestjs/common';
import { MongoModule } from './mongo/mongo.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';
import { TrendingModule } from './modules/trending/trending.module';
import { PersonalFeedModule } from './modules/personal-feed/personal-feed.module';
import { CacheLayerModule } from './modules/cache-layer/cache-layer.module';

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
    ScheduleModule.forRoot(),
    MongoModule,
    TrendingModule,
    PersonalFeedModule,
    CacheLayerModule,
  ],
  controllers: [],
  providers: [],
})
export class TCPAppModule {}
