import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { MongooseModule } from '@nestjs/mongoose';
import {
  PostSnapshot,
  PostSnapshotSchema,
} from 'src/mongo/schema/post-snapshot.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PostSnapshot.name, schema: PostSnapshotSchema },
    ]),
  ],
  controllers: [IngestionController],
  providers: [IngestionService],
})
export class IngestionModule {}
