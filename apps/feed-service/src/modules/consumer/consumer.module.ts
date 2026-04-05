import { Module } from '@nestjs/common';

import { ConsumerController } from './consumer.controller';
import { ConsumerService } from './consumer.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from 'src/mongo/schema/post-snapshot.schema';
import { AffinityModule } from '../affinity/affinity.module';
import { FeedItem, FeedItemSchema } from 'src/mongo/schema/feed-item.schema';
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from 'src/mongo/schema/share-snapshot.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
      { name: FeedItem.name, schema: FeedItemSchema },
    ]),
    AffinityModule,
  ],
  controllers: [ConsumerController],
  providers: [ConsumerService],
})
export class ConsumerModule {}
