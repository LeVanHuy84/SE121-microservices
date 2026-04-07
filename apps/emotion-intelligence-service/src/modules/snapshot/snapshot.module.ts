import { Module } from '@nestjs/common';
import { SnapshotCron } from './snapshot.cron';
import { SnapshotProcessor } from './snapshot.processor';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotService } from './snapshot.service';

@Module({
  providers: [
    SnapshotRepository,
    SnapshotService,
    SnapshotProcessor,
    SnapshotCron,
  ],
  exports: [SnapshotRepository, SnapshotService, SnapshotProcessor],
})
export class SnapshotModule {}
