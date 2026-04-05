import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RiskLevel } from '@repo/dtos';
import { WarningService } from './warning.service';

@Injectable()
export class WarningProcessor {
  private readonly logger = new Logger(WarningProcessor.name);
  private readonly processingUsers = new Set<string>();
  private readonly lastProcessedAt = new Map<string, number>();
  private readonly MIN_INTERVAL_MS = 5000;

  constructor(
    private readonly warningService: WarningService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('snapshot.updated')
  async handleSnapshotUpdated(payload: { userId: string }): Promise<void> {
    await this.processUserRisk(payload.userId);
  }

  @OnEvent('snapshot.batch.updated')
  async handleBatch(payload: { userIds: string[] }): Promise<void> {
    for (const userId of payload.userIds ?? []) {
      await this.processUserRisk(userId);
    }
  }

  async evaluateUsers(userIds: string[]): Promise<void> {
    for (const userId of userIds) {
      await this.processUserRisk(userId);
    }
  }

  private async processUserRisk(userId: string): Promise<void> {
    if (this.processingUsers.has(userId)) {
      return;
    }

    this.processingUsers.add(userId);

    const now = Date.now();
    const last = this.lastProcessedAt.get(userId);

    if (last && now - last < this.MIN_INTERVAL_MS) {
      this.processingUsers.delete(userId);
      return;
    }

    this.lastProcessedAt.set(userId, now);

    // CLEANUP
    if (this.lastProcessedAt.size > 10000) {
      const cutoff = now - 60_000; // giữ lại 1 phút gần nhất

      for (const [key, value] of this.lastProcessedAt) {
        if (value < cutoff) {
          this.lastProcessedAt.delete(key);
        }
      }
    }

    try {
      this.logger.log(`Evaluating risk for user=${userId}`);
      const evaluation = await this.warningService.evaluateUserRisk(userId);
      if (evaluation.shouldNotify) {
        this.eventEmitter.emit('risk.detected', {
          userId: evaluation.userId,
          riskLevel: evaluation.riskLevel,
          riskScore: evaluation.riskScore,
        });
      }
    } catch (error) {
      this.logger.error(
        `Risk evaluation failed for user=${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.processingUsers.delete(userId);
    }
  }
}
