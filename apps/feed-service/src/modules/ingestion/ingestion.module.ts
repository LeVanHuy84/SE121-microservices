import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from 'src/mongo/schema/post-snapshot.schema';
import { DistributionService } from '../distribution/distribution.service';
import { FeedItem, FeedItemSchema } from 'src/mongo/schema/feed-item.schema';
import { DistributionModule } from '../distribution/distribution.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
    ]),
    DistributionModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService],
})
export class IngestionModule {}
