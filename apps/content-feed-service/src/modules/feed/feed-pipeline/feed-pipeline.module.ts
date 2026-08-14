import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { FeedItem, FeedItemSchema } from "../mongo/schema/feed-item.schema";
import {
  PostSnapshot,
  PostSnapshotSchema,
} from "../mongo/schema/post-snapshot.schema";
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from "../mongo/schema/share-snapshot.schema";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RankingModule } from "../ranking/ranking.module";
import { UserSocialClientModule } from "../../post/client/user-social-client.module";
import { ReactionModule } from "../../post/reaction/reaction.module";
import { PersonalFeedController } from "./controllers/personal-feed.controller";
import { TrendingController } from "./controllers/trending.controller";
import { PersonalFeedService } from "./services/personal-feed.service";
import { TrendingService } from "./services/trending.service";
import { TrendingWorker } from "./services/trending-score-worker";
import { AffinityModule } from "../affinity/affinity.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FeedItem.name, schema: FeedItemSchema },
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
    ]),
    UserSocialClientModule,
    ReactionModule,
    RankingModule,
    AffinityModule,
  ],
  controllers: [PersonalFeedController, TrendingController],
  providers: [PersonalFeedService, TrendingService, TrendingWorker],
})
export class FeedPipelineModule {}
