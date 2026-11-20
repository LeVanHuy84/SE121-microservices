import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { RiskLevel } from '@repo/dtos';
import Redis from 'ioredis';
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
    @Optional() @InjectRedis() private readonly redis?: Redis,
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

    if (this.redis) {
      const consecutiveNegativeDays = Number(
        profile?.consecutiveNegativeDays ?? 0,
      );
      const persistentDistress =
        nextLevel === RiskLevel.MODERATE_RISK ||
        nextLevel === RiskLevel.HIGH_RISK ||
        nextLevel === RiskLevel.CRISIS ||
        consecutiveNegativeDays >= 3;
      const key = `emotion:longitudinal:${userId}`;
      const hashFields: Record<string, string> = {
        hysteresis_risk_level: String(nextLevel),
        risk_score: String(payload.riskScore),
        stable_windows: String(payload.stableWindows),
        consecutive_negative_days: String(consecutiveNegativeDays),
        persistent_distress: persistentDistress ? 'true' : 'false',
        longitudinal_updated_at: now.toISOString(),
      };
      if (nextLevel === RiskLevel.NORMAL) {
        hashFields.suggested_action = 'NO_ACTION';
        hashFields.chatbot_prompt_context = '';
      }
      try {
        await this.redis
          .pipeline()
          .hset(key, hashFields)
          .expire(key, 86400)
          .exec();
      } catch (err) {
        this.logger.warn(
          `Failed to update longitudinal Redis hash for user=${userId}`,
          err,
        );
      }
    }

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
