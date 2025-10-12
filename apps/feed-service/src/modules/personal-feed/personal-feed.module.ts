import { Module } from '@nestjs/common';
import { PersonalFeedController } from './personal-feed.controller';
import { PersonalFeedService } from './personal-feed.service';
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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FeedItem.name, schema: FeedItemSchema },
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
    ]),
  ],
  controllers: [PersonalFeedController],
  providers: [PersonalFeedService],
})
export class PersonalFeedModule {}
