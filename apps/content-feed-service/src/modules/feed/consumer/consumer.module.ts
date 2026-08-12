import { Module } from '@nestjs/common';

import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from '../mongo/schema/post-snapshot.schema';
import { AffinityModule } from '../affinity/affinity.module';
import { FeedItem, FeedItemSchema } from '../mongo/schema/feed-item.schema';
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from '../mongo/schema/share-snapshot.schema';
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
    AffinityModule,
    IdempotencyModule.forMongo(),
    KafkaProducerModule.registerAsync(), // để dùng DLQ
  ],
  controllers: [ConsumerController],
  providers: [ConsumerService, KafkaDLQService, KafkaConsumerHelper],
})
export class FeedConsumerModule {}
