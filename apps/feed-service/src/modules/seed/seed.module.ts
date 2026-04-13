import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from '../../mongo/schema/post-snapshot.schema';
import { FeedItem, FeedItemSchema } from '../../mongo/schema/feed-item.schema';
import { SeedService } from './seed.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: FeedItem.name, schema: FeedItemSchema },
    ]),
  ],
  providers: [SeedService],
  exports: [SeedService],
})
export class SeedModule {}
