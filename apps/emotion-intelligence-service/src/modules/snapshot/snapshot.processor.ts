import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EmotionTimeWindow } from '@repo/dtos';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotService } from './snapshot.service';

@Injectable()
export class SnapshotProcessor {
  private readonly logger = new Logger(SnapshotProcessor.name);

  constructor(
    private readonly snapshotRepository: SnapshotRepository,
    private readonly snapshotService: SnapshotService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async recomputeUserSnapshots(
    userId: string,
    referenceTime: Date = new Date(),
  ): Promise<{ success: boolean; userId: string; snapshotsUpdated: number }> {
    try {
      // ===== TIME WINDOWS =====
      const since1d = new Date(
        referenceTime.getTime() - 1 * 24 * 60 * 60 * 1000,
      );
      const since7d = new Date(
        referenceTime.getTime() - 7 * 24 * 60 * 60 * 1000,
      );
      const since30d = new Date(
        referenceTime.getTime() - 30 * 24 * 60 * 60 * 1000,
      );

      // ===== PREVIOUS SNAPSHOTS =====
      const [previous1d, previous7d, previous30d] = await Promise.all([
        this.snapshotRepository.getLatestSnapshot(
          userId,
          EmotionTimeWindow.ONE_DAY,
        ),
        this.snapshotRepository.getLatestSnapshot(
          userId,
          EmotionTimeWindow.SEVEN_DAYS,
        ),
        this.snapshotRepository.getLatestSnapshot(
          userId,
          EmotionTimeWindow.THIRTY_DAYS,
        ),
      ]);

      // ===== DECIDE BEFORE QUERY =====
      const shouldCompute7d = this.shouldRecompute(
        previous7d?.createdAt,
        referenceTime,
        6,
      );

      const shouldCompute30d = this.shouldRecompute(
        previous30d?.createdAt,
        referenceTime,
        24,
      );

      // always compute 1d
      const shouldCompute1d = true;

      // determine minimal query range
      let querySince = since1d;
      if (shouldCompute30d) {
        querySince = since30d;
      } else if (shouldCompute7d) {
        querySince = since7d;
      }

      // ===== AGGREGATES (minimal query) =====
      const aggregates = await this.snapshotRepository.getAggregatesByUserSince(
        userId,
        querySince,
        referenceTime,
      );

      // derive subsets
      const aggregates1d = aggregates.filter(
        (a) => new Date(a.createdAt) >= since1d,
      );

      const aggregates7d = shouldCompute7d
        ? aggregates.filter((a) => new Date(a.createdAt) >= since7d)
        : [];

      const aggregates30d = shouldCompute30d ? aggregates : [];

      // ===== COMPUTE =====
      const snapshot1d = this.snapshotService.computeSnapshot(
        userId,
        EmotionTimeWindow.ONE_DAY,
        aggregates1d,
        previous1d,
        referenceTime,
      );

      let snapshot7d;
      if (shouldCompute7d) {
        snapshot7d = this.snapshotService.computeSnapshot(
          userId,
          EmotionTimeWindow.SEVEN_DAYS,
          aggregates7d,
          previous7d,
          referenceTime,
        );
      }

      let snapshot30d;
      if (shouldCompute30d) {
        snapshot30d = this.snapshotService.computeSnapshot(
          userId,
          EmotionTimeWindow.THIRTY_DAYS,
          aggregates30d,
          previous30d,
          referenceTime,
        );
      }

      // ===== WRITE =====
      const insertPromises: Promise<void>[] = [];

      // 1d always
      insertPromises.push(this.snapshotRepository.insertSnapshot(snapshot1d));

      if (shouldCompute7d && snapshot7d) {
        insertPromises.push(this.snapshotRepository.insertSnapshot(snapshot7d));
      }

      if (shouldCompute30d && snapshot30d) {
        insertPromises.push(
          this.snapshotRepository.insertSnapshot(snapshot30d),
        );
      }

      await Promise.all(insertPromises);

      this.logger.log(
        `Inserted ${insertPromises.length} snapshots for user=${userId}`,
      );

      // ===== EVENT =====
      this.eventEmitter.emit('snapshot.updated', {
        userId,
        timestamp: referenceTime.toISOString(),
      });

      return {
        success: true,
        userId,
        snapshotsUpdated: insertPromises.length,
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

  // ===== SEED =====
  async backfillUserSnapshots(
    userId: string,
    options?: {
      startTime?: Date;
      endTime?: Date;
      stepMinutes?: number;
    },
  ): Promise<void> {
    const endTime = options?.endTime ?? new Date();
    const stepMinutes = options?.stepMinutes ?? 60;

    // 👇 lấy event cũ nhất để biết bắt đầu từ đâu
    const earliestEvent =
      await this.snapshotRepository.getEarliestEventTime(userId);

    if (!earliestEvent) return;

    const startTime =
      options?.startTime ??
      new Date(
        earliestEvent.getTime() + 24 * 60 * 60 * 1000, // bắt đầu sau khi đủ 1d data
      );

    this.logger.log(
      `🕰 Backfilling snapshots for user=${userId} from ${startTime.toISOString()} → ${endTime.toISOString()}`,
    );

    let cursor = new Date(startTime);
    let count = 0;

    while (cursor <= endTime) {
      await this.recomputeUserSnapshots(userId, new Date(cursor));
      cursor = new Date(cursor.getTime() + stepMinutes * 60 * 1000);
      count++;
    }

    this.logger.log(
      `✅ Backfilled ${count} snapshot points for user=${userId}`,
    );
  }

  // ===== HELPERS =====

  private shouldRecompute(
    lastCreatedAt: Date | undefined,
    now: Date,
    requiredHours: number,
  ): boolean {
    if (!lastCreatedAt) return true;

    const diffHours =
      (now.getTime() - new Date(lastCreatedAt).getTime()) / (1000 * 60 * 60);

    return diffHours >= requiredHours;
  }
}
