import { Injectable, Logger } from '@nestjs/common';
import { EmotionTimeWindow } from '@repo/dtos';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotService } from './snapshot.service';

@Injectable()
export class SnapshotProcessor {
  private readonly logger = new Logger(SnapshotProcessor.name);

  constructor(
    private readonly snapshotRepository: SnapshotRepository,
    private readonly snapshotService: SnapshotService,
  ) {}

  async recomputeUserSnapshots(
    userId: string,
    referenceTime: Date = new Date(),
  ): Promise<{ success: boolean; userId: string; snapshotsUpdated: number }> {
    try {
      const since1d = new Date(
        referenceTime.getTime() - 1 * 24 * 60 * 60 * 1000,
      );
      const since30d = new Date(
        referenceTime.getTime() - 30 * 24 * 60 * 60 * 1000,
      );
      const since7d = new Date(
        referenceTime.getTime() - 7 * 24 * 60 * 60 * 1000,
      );

      const aggregates30d =
        await this.snapshotRepository.getAggregatesByUserSince(
          userId,
          since30d,
          referenceTime,
        );

      const aggregates7d = aggregates30d.filter(
        (aggregate) => new Date(aggregate.createdAt) >= since7d,
      );
      const aggregates1d = aggregates30d.filter(
        (aggregate) => new Date(aggregate.createdAt) >= since1d,
      );

      const [previous1d, previous7d, previous30d] = await Promise.all([
        this.snapshotRepository.getUserWindowSnapshot(
          userId,
          EmotionTimeWindow.ONE_DAY,
        ),
        this.snapshotRepository.getUserWindowSnapshot(
          userId,
          EmotionTimeWindow.SEVEN_DAYS,
        ),
        this.snapshotRepository.getUserWindowSnapshot(
          userId,
          EmotionTimeWindow.THIRTY_DAYS,
        ),
      ]);

      const snapshot1d = this.snapshotService.computeSnapshot(
        userId,
        EmotionTimeWindow.ONE_DAY,
        aggregates1d,
        previous1d,
        referenceTime,
      );

      const snapshot7d = this.snapshotService.computeSnapshot(
        userId,
        EmotionTimeWindow.SEVEN_DAYS,
        aggregates7d,
        previous7d,
        referenceTime,
      );
      const snapshot30d = this.snapshotService.computeSnapshot(
        userId,
        EmotionTimeWindow.THIRTY_DAYS,
        aggregates30d,
        previous30d,
        referenceTime,
      );

      await this.snapshotRepository.upsertUserWindowSnapshot(
        userId,
        EmotionTimeWindow.ONE_DAY,
        snapshot1d,
      );

      await this.snapshotRepository.upsertUserWindowSnapshot(
        userId,
        EmotionTimeWindow.SEVEN_DAYS,
        snapshot7d,
      );
      await this.snapshotRepository.upsertUserWindowSnapshot(
        userId,
        EmotionTimeWindow.THIRTY_DAYS,
        snapshot30d,
      );

      return {
        success: true,
        userId,
        snapshotsUpdated: 3,
      };
    } catch (error) {
      this.logger.error(
        `Failed to recompute snapshots for user=${userId}`,
        error instanceof Error ? error.stack : String(error),
      );

      return {
        success: false,
        userId,
        snapshotsUpdated: 0,
      };
    }
  }
}
