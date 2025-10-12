import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionPostService } from './ingestion-post.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from 'src/mongo/schema/post-snapshot.schema';
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from 'src/mongo/schema/share-snapshot.schema';
import { IngestionShareService } from './ingestion-share.service';
import { StatsIngestionService } from './ingestion-stats.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { FeedItem, FeedItemSchema } from 'src/mongo/schema/feed-item.schema';
import { MICROSERVICE_CLIENT } from 'src/constants';
import { DistributionService } from './distribution.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
      { name: FeedItem.name, schema: FeedItemSchema },
    ]),
    ClientsModule.registerAsync([
      {
        name: MICROSERVICE_CLIENT.SOCIAL_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.REDIS,
          options: {
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            db: 1,
          },
        }),
      },
    ]),
  ],
  controllers: [IngestionController],
  providers: [
    IngestionPostService,
    IngestionShareService,
    StatsIngestionService,
    DistributionService,
  ],
  exports: [],
})
export class IngestionModule {}
