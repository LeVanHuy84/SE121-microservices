import { Module } from '@nestjs/common';
import { SearchModule } from './modules/search/search-all/search.module';
import { ConfigModule } from '@nestjs/config';
import { ElasticsearchModule } from './elastic/elastic.module';
import { IndexerModule } from './modules/search/indexer/indexer.module';
import { ScheduleModule } from '@nestjs/schedule';
import { InitModule } from './modules/search/_init/init.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RedisModule } from '@nestjs-modules/ioredis';
import { KafkaConsumerModule } from './modules/search/consumer/kafka-consumer.module';

// Recommendation Port
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { ProfileEmbedding } from './modules/recommendation/entities/profile-embedding.entity';
import { RecommendationFriendship } from './modules/recommendation/entities/recommendation-friendship.entity';
import { RecommendationPendingRequest } from './modules/recommendation/entities/recommendation-pending-request.entity';
import { RecommendationBlock } from './modules/recommendation/entities/recommendation-block.entity';
import { RecommendationDismissal } from './modules/recommendation/entities/recommendation-dismissal.entity';
import { RecommendationGraphEventJournal } from './modules/recommendation/entities/recommendation-graph-event-journal.entity';
import { RecommendationPairFeature } from './modules/recommendation/entities/recommendation-pair-feature.entity';
import { RecommendationGlobalFallbackCandidate } from './modules/recommendation/entities/recommendation-global-fallback-candidate.entity';
import { RecommendationEmotionProfile } from './modules/recommendation/entities/recommendation-emotion-profile.entity';

// Music Port
import { MusicModule } from './modules/music/music.module';
import { MusicFeature } from './modules/music/entities/music-feature.entity';
import { PostgresProcessedEvent } from '@repo/common';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
    }),
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT
          ? parseInt(process.env.REDIS_PORT, 10)
          : 6379,
      },
    }),
    ScheduleModule.forRoot(),
    ElasticsearchModule,
    SearchModule,
    IndexerModule,
    InitModule,
    KafkaConsumerModule,

    // Single Postgres DB connection for both recommendation & music using DATABASE_URL
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ||
        'postgresql://neondb_owner:npg_6nOGeaIYX0cs@ep-crimson-queen-anv4bjtt-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      entities: [
        ProfileEmbedding,
        RecommendationFriendship,
        RecommendationPendingRequest,
        RecommendationBlock,
        RecommendationDismissal,
        RecommendationGraphEventJournal,
        RecommendationPairFeature,
        RecommendationGlobalFallbackCandidate,
        RecommendationEmotionProfile,
        MusicFeature,
        PostgresProcessedEvent,
      ],
      synchronize: true,
      ssl: {
        rejectUnauthorized: false,
      },
    }),

    RecommendationModule,
    MusicModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
