import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseModule } from '@nestjs/mongoose';

import dbConfig from './config/db.config';

// === Post Modules ===
import { PostModule } from './modules/post/post/post.module';
import { ReactionModule } from './modules/post/reaction/reaction.module';
import { CommentModule } from './modules/post/comment/comment.module';
import { ShareModule } from './modules/post/share/share.module';
import { EventModule } from './modules/post/event/event.module';
import { StatsModule } from './modules/post/stats/stats.module';
import { ReportModule } from './modules/post/report/report.module';
import { ModerationModule } from './modules/post/moderation/moderation.module';
import { PostConsumerModule } from './modules/post/consumer/consumer.module';

// === Feed Modules ===
import { FeedMongoModule } from './modules/feed/mongo/mongo.module';
import { CacheLayerModule } from './modules/feed/cache-layer/cache-layer.module';
import { RankingModule } from './modules/feed/ranking/ranking.module';
import { FeedPipelineModule } from './modules/feed/feed-pipeline/feed-pipeline.module';
import { IngestionModule } from './modules/feed/ingestion/ingestion.module';
import { FeedConsumerModule } from './modules/feed/consumer/consumer.module';
import { WarmupModule } from './modules/feed/warmup/warmup.module';

// === Notification Modules ===
import { NotificationMongoModule } from './modules/notification/mongo/mongo.module';
import { FirebaseModule } from './modules/notification/firebase/firebase.module';
import { NotificationModule } from './modules/notification/notification/notification.module';
import { UserPreferenceModule } from './modules/notification/user-preference/user-preference.module';

// === Media Modules ===
import { MediaModule } from './modules/media/media/media.module';
import { MediaConsumerModule } from './modules/media/consumer/kafka-consumer.module';

// === Logging Modules ===
import { LoggingMongoModule } from './modules/logging/mongo/mongo.module';
import { LogModule } from './modules/logging/log/log.module';
import { LoggingConsumerModule } from './modules/logging/consumer/consumer.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      load: [dbConfig],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: dbConfig,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
        dbName: 'se121_content_feed', // Combined database name
        retryWrites: true,
        w: 'majority',
      }),
      inject: [ConfigService],
    }),
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        options: {
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: configService.get<string>('REDIS_PORT')
            ? parseInt(configService.get<string>('REDIS_PORT')!, 10)
            : 6379,
        },
      }),
    }),
    ScheduleModule.forRoot(),

    // Post Modules
    PostModule,
    ReactionModule,
    CommentModule,
    ShareModule,
    EventModule,
    StatsModule,
    ReportModule,
    ModerationModule,
    PostConsumerModule,

    // Feed Modules
    FeedMongoModule,
    CacheLayerModule,
    RankingModule,
    FeedPipelineModule,
    IngestionModule,
    FeedConsumerModule,
    WarmupModule,

    // Notification Modules
    NotificationMongoModule,
    FirebaseModule,
    NotificationModule,
    UserPreferenceModule,

    // Media Modules
    MediaModule,
    MediaConsumerModule,

    // Logging Modules
    LoggingMongoModule,
    LogModule,
    LoggingConsumerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
