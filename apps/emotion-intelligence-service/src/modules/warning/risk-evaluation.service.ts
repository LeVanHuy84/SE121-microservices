import { Injectable } from '@nestjs/common';
import { RiskLevel } from '@repo/dtos';

const RISK_CONFIG = {
  thresholds: {
    enter: {
      MILD_STRESS: 0.3,
      MODERATE_RISK: 0.5,
      HIGH_RISK: 0.7,
      CRISIS: 0.85,
    },
    exit: {
      MILD_STRESS: 0.2,
      MODERATE_RISK: 0.4,
      HIGH_RISK: 0.6,
      CRISIS: 0.75,
    },
  },
  stableWindowsRequired: 2,
  cooldownMs: 12 * 60 * 60 * 1000,
  spikeThreshold: 0.25,
} as const;

export interface ProfileSpikeSignals {
  decayedNegativityScore?: number;
  consecutiveNegativeDays?: number;
  emotionMomentum?: number;
  lastEventAt?: Date;
}

@Injectable()
export class RiskEvaluationService {
  computeNextLevel(
    currentLevel: RiskLevel,
    score: number,
    stableWindows: number,
    previousScore: number,
    ignoreStableUpward = false,
  ): RiskLevel {
    const safeScore = this.clamp01(score);
    const safePreviousScore = this.clamp01(previousScore);
    const safeStable = Math.max(0, Math.floor(Number(stableWindows) || 0));

    const candidate = this.computeCandidateLevel(currentLevel, safeScore);
    if (candidate === currentLevel) {
      return currentLevel;
    }

    const isUpward = this.levelRank(candidate) > this.levelRank(currentLevel);
    if (isUpward && ignoreStableUpward) {
      return candidate;
    }

    const currentSatisfied = this.meetsTransitionCondition(
      currentLevel,
      candidate,
      safeScore,
    );
    const previousSatisfied = this.meetsTransitionCondition(
      currentLevel,
      candidate,
      safePreviousScore,
    );

    const transitionStable = currentSatisfied
      ? previousSatisfied
        ? Math.max(RISK_CONFIG.stableWindowsRequired, safeStable + 1)
        : 1
      : 0;

    return transitionStable >= RISK_CONFIG.stableWindowsRequired
      ? candidate
      : currentLevel;
  }

  isSpike(
    profile: ProfileSpikeSignals | null,
    currentScore: number,
    previousScore: number,
  ): boolean {
    const decayedNegativityScore = this.clamp01(
      profile?.decayedNegativityScore ?? 0,
    );
    const emotionMomentum = this.clampSigned(profile?.emotionMomentum ?? 0);
    const consecutiveNegativeDays = this.toSafeNumber(
      profile?.consecutiveNegativeDays,
    );

    const scoreDelta = Math.abs(
      this.clamp01(currentScore) - this.clamp01(previousScore),
    );

    return (
      (decayedNegativityScore > 0.8 && emotionMomentum > 0.5) ||
      consecutiveNegativeDays >= 3 ||
      scoreDelta > RISK_CONFIG.spikeThreshold
    );
  }

  applySpikeOverride(
    currentLevel: RiskLevel,
    score: number,
    stableWindows: number,
    previousScore: number,
  ): RiskLevel {
    // OPTIONAL: nếu đã HIGH_RISK trở lên thì bỏ qua spike
    if (this.levelRank(currentLevel) >= this.levelRank(RiskLevel.HIGH_RISK)) {
      return currentLevel;
    }

    // Soft override: boost score thay vì ép WARNING
    const boostedScore = this.clamp01(score + 0.15);

    return this.computeNextLevel(
      currentLevel,
      boostedScore,
      stableWindows,
      previousScore,
      true, // bypass stability upward
    );
  }

  shouldNotify(
    previousLevel: RiskLevel,
    nextLevel: RiskLevel,
    now: Date,
    lastNotifiedAt?: Date,
  ): boolean {
    const isUpward = this.levelRank(nextLevel) > this.levelRank(previousLevel);
    if (!isUpward) {
      return false;
    }

    if (!lastNotifiedAt) {
      return true;
    }

    const elapsed = now.getTime() - new Date(lastNotifiedAt).getTime();
    return elapsed >= RISK_CONFIG.cooldownMs;
  }

  computeCandidateLevel(currentLevel: RiskLevel, score: number): RiskLevel {
    if (score >= RISK_CONFIG.thresholds.enter.CRISIS) {
      return RiskLevel.CRISIS;
    }
    if (score >= RISK_CONFIG.thresholds.enter.HIGH_RISK) {
      return RiskLevel.HIGH_RISK;
    }
    if (score >= RISK_CONFIG.thresholds.enter.MODERATE_RISK) {
      return RiskLevel.MODERATE_RISK;
    }
    if (score >= RISK_CONFIG.thresholds.enter.MILD_STRESS) {
      return RiskLevel.MILD_STRESS;
    }
    return RiskLevel.NORMAL;
  }

  private meetsTransitionCondition(
    currentLevel: RiskLevel,
    targetLevel: RiskLevel,
    score: number,
  ): boolean {
    const targetRank = this.levelRank(targetLevel);
    const currentRank = this.levelRank(currentLevel);

    if (targetRank > currentRank) {
      if (targetLevel === RiskLevel.MILD_STRESS)
        return score >= RISK_CONFIG.thresholds.enter.MILD_STRESS;
      if (targetLevel === RiskLevel.MODERATE_RISK)
        return score >= RISK_CONFIG.thresholds.enter.MODERATE_RISK;
      if (targetLevel === RiskLevel.HIGH_RISK)
        return score >= RISK_CONFIG.thresholds.enter.HIGH_RISK;
      if (targetLevel === RiskLevel.CRISIS)
        return score >= RISK_CONFIG.thresholds.enter.CRISIS;
    } else {
      if (currentLevel === RiskLevel.CRISIS)
        return score < RISK_CONFIG.thresholds.exit.CRISIS;
      if (currentLevel === RiskLevel.HIGH_RISK)
        return score < RISK_CONFIG.thresholds.exit.HIGH_RISK;
      if (currentLevel === RiskLevel.MODERATE_RISK)
        return score < RISK_CONFIG.thresholds.exit.MODERATE_RISK;
      if (currentLevel === RiskLevel.MILD_STRESS)
        return score < RISK_CONFIG.thresholds.exit.MILD_STRESS;
    }

    return false;
  }

  private maxLevel(left: RiskLevel, right: RiskLevel): RiskLevel {
    return this.levelRank(left) >= this.levelRank(right) ? left : right;
  }

  private levelRank(level: RiskLevel): number {
    switch (level) {
      case RiskLevel.NORMAL:
        return 0;
      case RiskLevel.MILD_STRESS:
        return 1;
      case RiskLevel.MODERATE_RISK:
        return 2;
      case RiskLevel.HIGH_RISK:
        return 3;
      case RiskLevel.CRISIS:
        return 4;
      default:
        return 0;
    }
  }

  private clamp01(value: number): number {
    const safe = this.toSafeNumber(value);
    return Math.max(0, Math.min(1, safe));
  }

  private clampSigned(value: number): number {
    const safe = this.toSafeNumber(value);
    return Math.max(-1, Math.min(1, safe));
  }

  private toSafeNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }
}
