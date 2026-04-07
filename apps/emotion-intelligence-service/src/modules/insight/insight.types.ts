import { InsightTone, InsightType, RiskLevel } from '@repo/dtos';

// ===== INSIGHT PROJECTIONS (DOMAIN PURPOSE) =====
export interface InsightProfileProjection {
  recentNegativityScore: number;
  negativeEventStreak: number;
  emotionMomentum: number;
  lastStrongNegativeAt?: Date;
}

export interface InsightRiskStateProjection {
  riskLevel: RiskLevel;
  riskScore: number;
  previousRiskScore: number;
}

export interface InsightSnapshotProjection {
  emotionVolatility: number;
  negativeRatio: number;
  baselineNegativeRatio: number;
  trend: number;
}

export interface InsightContext {
  profile: InsightProfileProjection;
  riskState: InsightRiskStateProjection;
  snapshot1d: InsightSnapshotProjection;
}

export interface Insight {
  type: InsightType;
  message: string;
  tone: InsightTone;
  priority: number;
}

export interface InsightRule {
  type: string;
  evaluate(context: InsightContext): Insight | null;
}

export const INSIGHT_RULES = 'INSIGHT_RULES';

export const DEFAULT_STABLE_INSIGHT: Insight = {
  type: InsightType.STABLE_STATE,
  message: 'Cảm xúc của bạn hiện đang ổn định',
  tone: InsightTone.NEUTRAL,
  priority: 1,
};
