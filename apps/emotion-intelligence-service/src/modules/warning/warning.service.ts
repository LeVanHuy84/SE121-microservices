import { Injectable, Logger } from '@nestjs/common';
import { RiskLevel } from '@repo/dtos';
import { RiskStateProjection, WarningRepository } from './warning.repository';
import { RiskEvaluationService } from './risk-evaluation.service';

interface EvaluateRiskResult {
  userId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  stableWindows: number;
  spikeDetected: boolean;
  shouldNotify: boolean;
  lastNotifiedAt?: Date;
  lastEvaluatedAt: Date;
  reason?: 'SPIKE' | 'THRESHOLD';
}

@Injectable()
export class WarningService {
  private readonly logger = new Logger(WarningService.name);

  constructor(
    private readonly warningRepository: WarningRepository,
    private readonly riskEvaluationService: RiskEvaluationService,
  ) {}

  async evaluateUserRisk(userId: string): Promise<EvaluateRiskResult> {
    const now = new Date();

    const [snapshot, profile, currentState] = await Promise.all([
      this.warningRepository.findLatestSnapshot1d(userId),
      this.warningRepository.findProfileSignals(userId),
      this.warningRepository.findRiskState(userId),
    ]);

    const activeState = currentState ?? this.buildDefaultState(userId);
    const snapshotRiskScore = this.toClamped01(snapshot?.riskScore);

    // detect spike trước
    const spikeDetected = this.riskEvaluationService.isSpike(
      profile,
      snapshotRiskScore,
      activeState.riskScore,
    );

    // compute next level
    const nextLevel = spikeDetected
      ? this.riskEvaluationService.applySpikeOverride(
          activeState.riskLevel,
          snapshotRiskScore,
          activeState.stableWindows,
          activeState.previousRiskScore,
        )
      : this.riskEvaluationService.computeNextLevel(
          activeState.riskLevel,
          snapshotRiskScore,
          activeState.stableWindows,
          activeState.previousRiskScore,
          false,
        );

    // update stability
    const stableWindows =
      nextLevel === activeState.riskLevel ? activeState.stableWindows + 1 : 1;

    // notify check
    const shouldNotify = this.riskEvaluationService.shouldNotify(
      activeState.riskLevel,
      nextLevel,
      now,
      activeState.lastNotifiedAt,
    );

    // reason (debug)
    const reason: 'SPIKE' | 'THRESHOLD' = spikeDetected ? 'SPIKE' : 'THRESHOLD';

    const payload: Omit<RiskStateProjection, 'userId'> = {
      riskLevel: nextLevel,
      riskScore: snapshotRiskScore,
      stableWindows,
      previousRiskScore: this.toClamped01(activeState.riskScore),
      lastEvaluatedAt: now,
      lastNotifiedAt: shouldNotify ? now : activeState.lastNotifiedAt,
    };

    await this.warningRepository.upsertRiskState(userId, payload);

    return {
      userId,
      riskLevel: payload.riskLevel,
      riskScore: payload.riskScore,
      stableWindows: payload.stableWindows,
      spikeDetected,
      shouldNotify,
      lastNotifiedAt: payload.lastNotifiedAt,
      lastEvaluatedAt: now,
      reason,
    };
  }

  private buildDefaultState(userId: string): RiskStateProjection {
    return {
      userId,
      riskLevel: RiskLevel.NORMAL,
      riskScore: 0,
      stableWindows: 0,
      previousRiskScore: 0,
      lastNotifiedAt: undefined,
      lastEvaluatedAt: undefined,
    };
  }

  private toClamped01(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 0;
    }

    return Math.max(0, Math.min(1, numeric));
  }
}
