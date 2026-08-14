import { Module } from "@nestjs/common";
import { FeedMongoModule } from "../mongo/mongo.module";
import { AppInitService } from "./services/app-init.service";
import { RedisTrendingWarmupService } from "./services/redis-trending-warmup.service";

@Module({
  imports: [FeedMongoModule],
  providers: [RedisTrendingWarmupService, AppInitService],
})
export class WarmupModule {}
