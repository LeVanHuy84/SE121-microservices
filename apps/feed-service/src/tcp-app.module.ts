import { Module } from '@nestjs/common';
import { MongoModule } from './mongo/mongo.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheLayerModule } from './modules/cache-layer/cache-layer.module';
import { RankingModule } from './modules/ranking/ranking.module';
import { FeedPipelineModule } from './modules/feed-pipeline/feed-pipeline.module';

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
    RankingModule,
    FeedPipelineModule,
    CacheLayerModule,
  ],
  controllers: [],
  providers: [],
})
export class TCPAppModule {}
