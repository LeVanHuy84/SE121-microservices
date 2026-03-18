import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FeedItem, FeedItemSchema } from 'src/mongo/schema/feed-item.schema';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from 'src/mongo/schema/post-snapshot.schema';
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from 'src/mongo/schema/share-snapshot.schema';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RankingModule } from '../ranking/ranking.module';
import { PersonalFeedController } from './controllers/personal-feed.controller';
import { TrendingController } from './controllers/trending.controller';
import { PersonalFeedService } from './services/personal-feed.service';
import { TrendingService } from './services/trending.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FeedItem.name, schema: FeedItemSchema },
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
    ]),
    ClientsModule.registerAsync([
      {
        name: 'POST_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>('POST_SERVICE_HOST') || 'localhost',
            port: config.get<number>('POST_SERVICE_PORT'),
          },
        }),
      },
      {
        name: 'GROUP_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>('GROUP_SERVICE_HOST') || 'localhost',
            port: config.get<number>('GROUP_SERVICE_PORT'),
          },
        }),
      },
    ]),
    RankingModule, // ⭐ Import RankingModule
  ],
  controllers: [PersonalFeedController, TrendingController],
  providers: [PersonalFeedService, TrendingService],
})
export class FeedPipelineModule {}
