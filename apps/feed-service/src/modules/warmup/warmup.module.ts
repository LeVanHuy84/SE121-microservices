import { Module } from '@nestjs/common';
import { MongoModule } from 'src/mongo/mongo.module';
import { AppInitService } from './services/app-init.service';
import { RedisTrendingWarmupService } from './services/redis-trending-warmup.service';

@Module({
  imports: [MongoModule],
  providers: [RedisTrendingWarmupService, AppInitService],
})
export class WarmupModule {}
