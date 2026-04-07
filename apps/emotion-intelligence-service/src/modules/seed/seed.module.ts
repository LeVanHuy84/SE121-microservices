import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { ProfileModule } from '../profile/profile.module';
import { SnapshotModule } from '../snapshot/snapshot.module';
import { WarningModule } from '../warning/warning.module';
import { EmotionGenerator } from './generators/emotion.generator';
import { TimelineGenerator } from './generators/timeline.generator';
import { SeedController } from './seed.controller';
import { SeedService } from './seed.service';

@Module({
  imports: [IngestionModule, SnapshotModule, ProfileModule, WarningModule],
  controllers: [SeedController],
  providers: [SeedService, EmotionGenerator, TimelineGenerator],
  exports: [SeedService],
})
export class SeedModule {}
