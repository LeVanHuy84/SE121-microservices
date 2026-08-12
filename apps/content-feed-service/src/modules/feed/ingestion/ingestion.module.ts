import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionPostService } from './service/ingestion-post.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from '../mongo/schema/post-snapshot.schema';
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from '../mongo/schema/share-snapshot.schema';
import { IngestionShareService } from './service/ingestion-share.service';
import { StatsIngestionService } from './service/ingestion-stats.service';
import { FeedItem, FeedItemSchema } from '../mongo/schema/feed-item.schema';
import { DistributionService } from './service/distribution.service';
import { UserSocialClientModule } from '../../post/client/user-social-client.module';
import {
  IdempotencyModule,
  KafkaConsumerHelper,
  KafkaDLQService,
  KafkaProducerModule,
} from '@repo/common';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
      { name: FeedItem.name, schema: FeedItemSchema },
    ]),
    UserSocialClientModule,

    IdempotencyModule.forMongo(),
    KafkaProducerModule.registerAsync(), // để dùng DLQ
  ],
  controllers: [IngestionController],
  providers: [
    IngestionPostService,
    IngestionShareService,
    StatsIngestionService,
    DistributionService,
    KafkaDLQService,
    KafkaConsumerHelper,
  ],
  exports: [],
})
export class IngestionModule {}
