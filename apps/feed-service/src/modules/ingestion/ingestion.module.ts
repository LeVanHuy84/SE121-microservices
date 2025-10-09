import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionPostService } from './ingestion-post.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from 'src/mongo/schema/post-snapshot.schema';
import { DistributionModule } from '../distribution/distribution.module';
import {
  ShareSnapshot,
  ShareSnapshotSchema,
} from 'src/mongo/schema/share-snapshot.schema';
import { IngestionShareService } from './ingestion-share.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
      { name: ShareSnapshot.name, schema: ShareSnapshotSchema },
    ]),
    DistributionModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionPostService, IngestionShareService],
})
export class IngestionModule {}
