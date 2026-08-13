import { RiskLevel } from '@repo/dtos';
import {
  ProfileSpikeProjection,
  RiskStateProjection,
  Snapshot1dProjection,
} from '../warning/warning.repository';
import { AiContext, RiskDetectedEvent } from './ai.types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toTrendDirection(
  trendValue: number,
): 'increasing' | 'stable' | 'decreasing' {
  if (trendValue > 0.05) {
    return 'increasing';
  }

  if (trendValue < -0.05) {
    return 'decreasing';
  }

  return 'stable';
}

export function mapAiContext(params: {
  event: RiskDetectedEvent;
  snapshot: Snapshot1dProjection | null;
  profile: ProfileSpikeProjection | null;
  riskState: RiskStateProjection | null;
  now?: Date;
}): AiContext {
  const { event, snapshot, profile, riskState } = params;
  const now = params.now ?? new Date();

  const riskLevel = event.riskLevel ?? riskState?.riskLevel ?? RiskLevel.NORMAL;
  const riskScore = clamp(
    toNumber(event.riskScore, riskState?.riskScore ?? 0),
    0,
    1,
  );

  const negativeRatio = clamp(toNumber(snapshot?.negativeRatio, 0), 0, 1);
  const baselineNegativeRatio = clamp(
    toNumber(snapshot?.baselineNegativeRatio, 0),
    0,
    1,
  );
  const normalizedNegativity = clamp(
    negativeRatio - baselineNegativeRatio,
    -1,
    1,
  );

  const volatility = Math.max(0, toNumber(snapshot?.emotionVolatility, 0));
  const trend = toTrendDirection(toNumber(snapshot?.trend, 0));
  const recentNegativityScore = clamp(
    toNumber(profile?.recentNegativityScore, 0),
    0,
    1,
  );
  const negativeEventStreak = Math.max(
    0,
    Math.floor(toNumber(profile?.negativeEventStreak, 0)),
  );

  const lastEventAt = toDate(profile?.lastEventAt);
  const lastStrongNegativeAt = toDate(profile?.lastStrongNegativeAt);

  const hasRecentActivity = Boolean(
    lastEventAt && now.getTime() - lastEventAt.getTime() < ONE_DAY_MS,
  );

  const hasRecentStrongNegative = Boolean(
    lastStrongNegativeAt &&
    now.getTime() - lastStrongNegativeAt.getTime() < TWO_DAYS_MS,
  );

  return {
    riskLevel,
    riskScore,
    negativeRatio,
    baselineNegativeRatio,
    normalizedNegativity,
    volatility,
    trend,
    recentNegativityScore,
    negativeEventStreak,
    hasRecentActivity,
    hasRecentStrongNegative,
  };
}
