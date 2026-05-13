import { Injectable } from '@nestjs/common';
import { RiskLevel } from '@repo/dtos';

const RISK_CONFIG = {
  thresholds: {
    enter: {
      WARNING: 0.6,
      HIGH: 0.7,
      CRITICAL: 0.8,
    },
    exit: {
      WARNING: 0.4,
      HIGH: 0.6,
      CRITICAL: 0.7,
    },
  },
  stableWindowsRequired: 2,
  cooldownMs: 12 * 60 * 60 * 1000,
  spikeThreshold: 0.25,
} as const;

export interface ProfileSpikeSignals {
  recentNegativityScore?: number;
  negativeEventStreak?: number;
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
    const recentNegativityScore = this.clamp01(
      profile?.recentNegativityScore ?? 0,
    );
    const emotionMomentum = this.clampSigned(profile?.emotionMomentum ?? 0);
    const negativeEventStreak = this.toSafeNumber(profile?.negativeEventStreak);

    const scoreDelta = Math.abs(
      this.clamp01(currentScore) - this.clamp01(previousScore),
    );

    return (
      (recentNegativityScore > 0.8 && emotionMomentum > 0.5) ||
      negativeEventStreak >= 5 ||
      scoreDelta > RISK_CONFIG.spikeThreshold
    );
  }

  applySpikeOverride(
    currentLevel: RiskLevel,
    score: number,
    stableWindows: number,
    previousScore: number,
  ): RiskLevel {
    // OPTIONAL: nếu đã HIGH trở lên thì bỏ qua spike
    if (this.levelRank(currentLevel) >= this.levelRank(RiskLevel.HIGH)) {
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

  private computeCandidateLevel(
    currentLevel: RiskLevel,
    score: number,
  ): RiskLevel {
    if (currentLevel === RiskLevel.NORMAL) {
      return score >= RISK_CONFIG.thresholds.enter.WARNING
        ? RiskLevel.WARNING
        : RiskLevel.NORMAL;
    }

    if (currentLevel === RiskLevel.WARNING) {
      if (score >= RISK_CONFIG.thresholds.enter.HIGH) {
        return RiskLevel.HIGH;
      }
      if (score < RISK_CONFIG.thresholds.exit.WARNING) {
        return RiskLevel.NORMAL;
      }
      return RiskLevel.WARNING;
    }

    if (currentLevel === RiskLevel.HIGH) {
      if (score >= RISK_CONFIG.thresholds.enter.CRITICAL) {
        return RiskLevel.CRITICAL;
      }
      if (score < RISK_CONFIG.thresholds.exit.HIGH) {
        return RiskLevel.WARNING;
      }
      return RiskLevel.HIGH;
    }

    return score < RISK_CONFIG.thresholds.exit.CRITICAL
      ? RiskLevel.HIGH
      : RiskLevel.CRITICAL;
  }

  private meetsTransitionCondition(
    currentLevel: RiskLevel,
    targetLevel: RiskLevel,
    score: number,
  ): boolean {
    if (
      currentLevel === RiskLevel.NORMAL &&
      targetLevel === RiskLevel.WARNING
    ) {
      return score >= RISK_CONFIG.thresholds.enter.WARNING;
    }
    if (currentLevel === RiskLevel.WARNING && targetLevel === RiskLevel.HIGH) {
      return score >= RISK_CONFIG.thresholds.enter.HIGH;
    }
    if (currentLevel === RiskLevel.HIGH && targetLevel === RiskLevel.CRITICAL) {
      return score >= RISK_CONFIG.thresholds.enter.CRITICAL;
    }
    if (currentLevel === RiskLevel.CRITICAL && targetLevel === RiskLevel.HIGH) {
      return score < RISK_CONFIG.thresholds.exit.CRITICAL;
    }
    if (currentLevel === RiskLevel.HIGH && targetLevel === RiskLevel.WARNING) {
      return score < RISK_CONFIG.thresholds.exit.HIGH;
    }
    if (
      currentLevel === RiskLevel.WARNING &&
      targetLevel === RiskLevel.NORMAL
    ) {
      return score < RISK_CONFIG.thresholds.exit.WARNING;
    }

    return false;
  }

  private maxLevel(left: RiskLevel, right: RiskLevel): RiskLevel {
    return this.levelRank(left) >= this.levelRank(right) ? left : right;
  }

  private levelRank(level: RiskLevel): number {
    if (level === RiskLevel.NORMAL) {
      return 0;
    }
    if (level === RiskLevel.WARNING) {
      return 1;
    }
    if (level === RiskLevel.HIGH) {
      return 2;
    }
    return 3;
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
