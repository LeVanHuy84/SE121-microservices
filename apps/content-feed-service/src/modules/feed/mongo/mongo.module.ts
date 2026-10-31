import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { SnapshotRepository } from "./repository/snapshot.repository";
import {
  PostSnapshot,
  PostSnapshotSchema,
} from "./schema/post-snapshot.schema";
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from "./schema/share-snapshot.schema";
import { FeedItem, FeedItemSchema } from "./schema/feed-item.schema";
import { CacheLayerModule } from "../cache-layer/cache-layer.module";

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
      { name: FeedItem.name, schema: FeedItemSchema },
    ]),
    CacheLayerModule,
  ],
  providers: [SnapshotRepository],
  exports: [MongooseModule, SnapshotRepository],
})
export class FeedMongoModule {}
