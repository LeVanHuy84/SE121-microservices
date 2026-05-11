import { Module } from '@nestjs/common';
import { SnapshotCron } from './snapshot.cron';
import { RecommendationEmotionEventPublisher } from './recommendation-emotion-event.publisher';
import { SnapshotProcessor } from './snapshot.processor';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotService } from './snapshot.service';
@Module({
  providers: [
    SnapshotRepository,
    SnapshotService,
    SnapshotProcessor,
    SnapshotCron,
    RecommendationEmotionEventPublisher,
  ],
  exports: [SnapshotRepository, SnapshotService, SnapshotProcessor],
})
export class SnapshotModule {}
