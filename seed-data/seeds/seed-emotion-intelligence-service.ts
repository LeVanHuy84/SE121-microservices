import 'reflect-metadata';

import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mongoose from 'mongoose';
import { EmotionTimeWindow, LowCaseEmotion, TargetType } from '@repo/dtos';
import {
  EmotionGenerator,
  type EmotionBehaviorProfile,
} from '../../apps/emotion-intelligence-service/src/modules/seed/generators/emotion.generator';
import {
  TimelineGenerator,
  createSeededRandom,
} from '../../apps/emotion-intelligence-service/src/modules/seed/generators/timeline.generator';
import {
  SNAPSHOT_EMOTIONS,
  type EmotionDistribution,
  type SnapshotAggregateEvent,
  type SnapshotPayload,
} from '../../apps/emotion-intelligence-service/src/modules/snapshot/snapshot.schema';
import {
  PROFILE_EMOTIONS,
  type EmotionVector,
  type ProfileAggregateEvent,
  type ProfileComputationResult,
  type ProfileEmotion,
} from '../../apps/emotion-intelligence-service/src/modules/profile/profile.schema';

type GeneratedUserRow = {
  userId: string;
  email?: string;
};

type SeedUser = GeneratedUserRow & {
  behavior: EmotionBehaviorProfile;
};

type AnalyticsSeedDoc = {
  userId: string;
  targetId: string;
  targetType: TargetType.POST;
  modelVersion: string;
  finalEmotion: LowCaseEmotion;
  finalScores: Record<LowCaseEmotion, number>;
  finalConfidence: number;
  riskHintLevel: string;
  createdAt: Date;
};

type UserEmotionSnapshotSeedDoc = SnapshotPayload & {
  updatedAt: Date;
};

type UserEmotionProfileSeedDoc = ProfileComputationResult & {
  userId: string;
  updatedAt: Date;
};

const ROOT_DIR = resolve(__dirname, '../..');
const USERS_FILE = resolve(__dirname, '../data/generated-users.json');
const ENV_CANDIDATES = [
  resolve(ROOT_DIR, 'apps/emotion-intelligence-service/.env'),
  resolve(ROOT_DIR, 'apps/emotion-intelligence-service/.env.local'),
];

const NEGATIVE_FOR_RATIO: ReadonlySet<LowCaseEmotion> = new Set([
  LowCaseEmotion.SADNESS,
  LowCaseEmotion.ANGER,
  LowCaseEmotion.FEAR,
]);

const NEGATIVE_FOR_SCORE: ReadonlySet<ProfileEmotion> = new Set([
  'sadness',
  'anger',
  'fear',
  'disgust',
]);

class LocalSnapshotCalculator {
  private readonly baselineAlphaByWindow: Record<EmotionTimeWindow, number> = {
    [EmotionTimeWindow.ONE_DAY]: 0.25,
    [EmotionTimeWindow.SEVEN_DAYS]: 0.2,
    [EmotionTimeWindow.THIRTY_DAYS]: 0.12,
  };

  computeSnapshot(
    userId: string,
    window: EmotionTimeWindow,
    aggregates: SnapshotAggregateEvent[],
    previousSnapshot?: Pick<
      SnapshotPayload,
      | 'emotionDistribution'
      | 'negativeRatio'
      | 'emotionVolatility'
      | 'trend'
      | 'baselineNegativeRatio'
      | 'riskScore'
    > | null,
    computedAt: Date = new Date(),
  ): SnapshotPayload {
    if (aggregates.length === 0) {
      return this.buildSnapshotWithoutEvents(
        userId,
        window,
        previousSnapshot,
        computedAt,
      );
    }

    const metrics = this.computeMetrics(aggregates);
    const previousNegativeRatio = this.clamp01(
      previousSnapshot?.negativeRatio ?? 0,
    );
    const previousBaseline = this.clamp01(
      previousSnapshot?.baselineNegativeRatio ?? previousNegativeRatio,
    );

    const trend = this.clampSigned(
      metrics.negativeRatio - previousNegativeRatio,
    );
    const baselineNegativeRatio = this.computeBaseline(
      window,
      previousBaseline,
      metrics.negativeRatio,
    );
    const riskScore = this.computeRiskScore(
      metrics.negativeRatio,
      metrics.emotionVolatility,
      trend,
      baselineNegativeRatio,
    );

    return {
      userId,
      window,
      emotionDistribution: this.ensureNormalizedDistribution(
        metrics.emotionDistribution,
      ),
      negativeRatio: this.clamp01(metrics.negativeRatio),
      emotionVolatility: this.clamp01(metrics.emotionVolatility),
      trend: this.clampSigned(trend),
      baselineNegativeRatio: this.clamp01(baselineNegativeRatio),
      riskScore: this.clamp01(riskScore),
      createdAt: computedAt,
    };
  }

  private buildSnapshotWithoutEvents(
    userId: string,
    window: EmotionTimeWindow,
    previousSnapshot:
      | Pick<
          SnapshotPayload,
          | 'emotionDistribution'
          | 'negativeRatio'
          | 'emotionVolatility'
          | 'trend'
          | 'baselineNegativeRatio'
          | 'riskScore'
        >
      | null
      | undefined,
    computedAt: Date,
  ): SnapshotPayload {
    if (previousSnapshot) {
      const negativeRatio = this.clamp01(
        (previousSnapshot.negativeRatio ?? 0) * 0.98,
      );
      const baselineNegativeRatio = this.clamp01(
        (previousSnapshot.baselineNegativeRatio ??
          previousSnapshot.negativeRatio ??
          0) * 0.995,
      );
      const riskScore = this.clamp01((previousSnapshot.riskScore ?? 0) * 0.97);

      return {
        userId,
        window,
        emotionDistribution: this.ensureNormalizedDistribution(
          previousSnapshot.emotionDistribution,
        ),
        negativeRatio,
        emotionVolatility: this.clamp01(
          previousSnapshot.emotionVolatility ?? 0,
        ),
        trend: this.clampSigned(previousSnapshot.trend ?? 0),
        baselineNegativeRatio,
        riskScore,
        createdAt: computedAt,
      };
    }

    return {
      userId,
      window,
      emotionDistribution: this.buildEmptyDistribution(),
      negativeRatio: 0,
      emotionVolatility: 0,
      trend: 0,
      baselineNegativeRatio: 0,
      riskScore: 0,
      createdAt: computedAt,
    };
  }

  private computeMetrics(aggregates: SnapshotAggregateEvent[]): {
    emotionDistribution: EmotionDistribution;
    negativeRatio: number;
    emotionVolatility: number;
  } {
    const counts = this.buildEmptyDistribution();
    let total = 0;
    const negativitySeries: number[] = [];

    for (const aggregate of aggregates) {
      const eventDistribution = this.resolveEventDistribution(aggregate);
      const eventNegativity = Array.from(NEGATIVE_FOR_RATIO).reduce(
        (sum, emotion) => sum + eventDistribution[emotion],
        0,
      );
      negativitySeries.push(this.clamp01(eventNegativity));

      for (const emotion of SNAPSHOT_EMOTIONS) {
        counts[emotion] += eventDistribution[emotion];
      }
      total += 1;
    }

    if (total === 0) {
      return {
        emotionDistribution: counts,
        negativeRatio: 0,
        emotionVolatility: 0,
      };
    }

    const emotionDistribution = this.normalizeDistribution(counts, total);
    const negativeRatio = this.clamp01(
      Array.from(NEGATIVE_FOR_RATIO).reduce(
        (acc, emotion) => acc + emotionDistribution[emotion],
        0,
      ),
    );

    const rawVolatility = this.calculateStdDev(negativitySeries);
    const dampedVolatility = rawVolatility * (1 - Math.exp(-total / 8));
    const boundedVolatility = Math.min(this.safeNumber(dampedVolatility), 1);

    return {
      emotionDistribution,
      negativeRatio: negativeRatio,
      emotionVolatility: this.clamp01(boundedVolatility),
    };
  }

  private resolveEventDistribution(
    aggregate: SnapshotAggregateEvent,
  ): EmotionDistribution {
    const scores = aggregate.finalScores;

    if (scores && Object.keys(scores).length > 0) {
      const distribution = this.buildEmptyDistribution();
      let total = 0;

      for (const [emotion, rawScore] of Object.entries(scores)) {
        if (!emotion) {
          continue;
        }

        const score = Number(rawScore);
        if (!Number.isFinite(score) || score <= 0) {
          continue;
        }

        distribution[emotion as LowCaseEmotion] += score;
        total += score;
      }

      if (total > 0) {
        return this.normalizeDistribution(distribution, total);
      }
    }

    const oneHot = this.buildEmptyDistribution();
    const finalEmotion = aggregate.finalEmotion;
    if (finalEmotion) {
      oneHot[finalEmotion as LowCaseEmotion] = 1;
    }

    return oneHot;
  }

  private computeBaseline(
    window: EmotionTimeWindow,
    previousBaseline: number,
    currentNegativeRatio: number,
  ): number {
    const alpha = this.baselineAlphaByWindow[window] ?? 0.15;
    return this.clamp01(
      alpha * currentNegativeRatio + (1 - alpha) * previousBaseline,
    );
  }

  private computeRiskScore(
    negativeRatio: number,
    volatility: number,
    trend: number,
    baseline: number,
  ): number {
    const nonlinearNegativity = this.clamp01(
      Math.pow(this.clamp01(negativeRatio), 1.3),
    );
    const trendUp = this.clamp01(Math.max(0, trend));

    const weighted =
      0.65 * nonlinearNegativity +
      0.15 * this.clamp01(baseline) +
      0.10 * volatility +
      0.10 * trendUp;

    return this.clamp01(weighted);
  }

  private buildEmptyDistribution(): EmotionDistribution {
    return SNAPSHOT_EMOTIONS.reduce((acc, emotion) => {
      acc[emotion] = 0;
      return acc;
    }, {} as EmotionDistribution);
  }

  private normalizeDistribution(
    counts: EmotionDistribution,
    total: number,
  ): EmotionDistribution {
    if (total <= 0 || !Number.isFinite(total)) {
      return this.buildEmptyDistribution();
    }

    return SNAPSHOT_EMOTIONS.reduce((acc, emotion) => {
      const raw = this.safeNumber(counts[emotion]);
      acc[emotion] = this.clamp01(raw / total);
      return acc;
    }, {} as EmotionDistribution);
  }

  private calculateStdDev(values: number[]): number {
    if (values.length <= 1) {
      return 0;
    }

    const sanitized = values.map((value) => this.safeNumber(value));
    const mean =
      sanitized.reduce((sum, value) => sum + value, 0) / sanitized.length;
    const variance =
      sanitized.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      sanitized.length;

    return this.safeNumber(Math.sqrt(variance));
  }

  private clamp01(value: number): number {
    const safe = this.safeNumber(value);
    return Math.max(0, Math.min(1, safe));
  }

  private clampSigned(value: number): number {
    const safe = this.safeNumber(value);
    return Math.max(-1, Math.min(1, Number(safe.toFixed(4))));
  }

  private ensureNormalizedDistribution(
    source: Record<string, number> | undefined,
  ): EmotionDistribution {
    const base = this.buildEmptyDistribution();
    let total = 0;

    for (const emotion of SNAPSHOT_EMOTIONS) {
      const value = this.clamp01(this.safeNumber(source?.[emotion]));
      base[emotion] = value;
      total += value;
    }

    if (total <= 0) {
      return this.buildEmptyDistribution();
    }

    return this.normalizeDistribution(base, total);
  }

  private safeNumber(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }
}

class LocalProfileCalculator {
  private readonly alpha = 0.2;
  private readonly negativityTauMs = 8 * 60 * 60 * 1000;
  private readonly streakTauMs = 12 * 60 * 60 * 1000;
  private readonly streakSoftResetMs = 24 * 60 * 60 * 1000;
  private readonly streakSoftResetFactor = 0.3;
  private readonly strongNegativeThreshold = 0.7;
  private readonly negativeEventThreshold = 0.55;
  private readonly positiveEventThreshold = 0.35;
  private readonly momentumSmoothPrevWeight = 0.7;
  private readonly momentumSmoothDeltaWeight = 0.3;

  applyEventLevelUpdate(
    previousEma: Partial<EmotionVector> | undefined,
    previousRecentNegativityScore = 0,
    events: ProfileAggregateEvent[],
    previousNegativeEventStreak = 0,
    previousLastEventAt?: Date,
    previousLastStrongNegativeAt?: Date,
    previousEmotionMomentum = 0,
  ): ProfileComputationResult {
    const normalizedPreviousEma = this.normalizeVector(previousEma);

    let previousEmaState = normalizedPreviousEma;
    let emotionVectorEMA = normalizedPreviousEma;
    let recentNegativityScore = this.clamp01(previousRecentNegativityScore);
    let negativeEventStreak = Math.max(0, previousNegativeEventStreak);
    let lastEventAt = previousLastEventAt;
    let lastStrongNegativeAt = previousLastStrongNegativeAt;
    let emotionMomentum = this.clampSigned(previousEmotionMomentum);

    for (const event of events) {
      const eventVector = this.resolveEventVector(event);
      const eventTime = new Date(event.createdAt);

      const previousRecentNegativity = recentNegativityScore;
      const decayedRecentNegativity = this.applyTimeDecay(
        previousRecentNegativity,
        lastEventAt,
        eventTime,
        this.negativityTauMs,
      );

      negativeEventStreak = this.applyStreakDecay(
        negativeEventStreak,
        lastEventAt,
        eventTime,
      );

      emotionVectorEMA = PROFILE_EMOTIONS.reduce((acc, emotion) => {
        acc[emotion] =
          this.alpha * eventVector[emotion] +
          (1 - this.alpha) * previousEmaState[emotion];
        return acc;
      }, {} as EmotionVector);

      const eventNegativity = this.calculateEventNegativity(event, eventVector);
      recentNegativityScore = this.clamp01(
        decayedRecentNegativity +
          eventNegativity * (1 - decayedRecentNegativity),
      );

      if (eventNegativity >= this.negativeEventThreshold) {
        negativeEventStreak += 1;
      } else if (eventNegativity <= this.positiveEventThreshold) {
        negativeEventStreak = Math.max(0, negativeEventStreak - 1);
      } else if (negativeEventStreak > 0) {
        negativeEventStreak = Math.max(0, negativeEventStreak - 0.5);
      }

      if (eventNegativity >= this.strongNegativeThreshold) {
        lastStrongNegativeAt = eventTime;
      }

      const currentDelta =
        this.calculateVectorDistance(emotionVectorEMA, previousEmaState) /
        (2 * this.alpha);
      emotionMomentum = this.clampSigned(
        emotionMomentum * this.momentumSmoothPrevWeight +
          currentDelta * this.momentumSmoothDeltaWeight,
      );

      previousEmaState = emotionVectorEMA;
      lastEventAt = eventTime;
    }

    return {
      emotionVectorEMA,
      recentNegativityScore,
      negativeEventStreak: this.clampNonNegative(negativeEventStreak),
      lastEventAt,
      lastStrongNegativeAt,
      emotionMomentum,
    };
  }

  private resolveEventVector(event: ProfileAggregateEvent): EmotionVector {
    const scores = event.finalScores;
    if (scores && Object.keys(scores).length > 0) {
      const mapped = this.buildEmptyVector();
      let total = 0;

      for (const [emotion, scoreRaw] of Object.entries(scores)) {
        const normalized = this.normalizeEmotion(emotion);
        if (!normalized) {
          continue;
        }

        const score = Number(scoreRaw);
        if (Number.isNaN(score) || score < 0) {
          continue;
        }

        mapped[normalized] += score;
        total += score;
      }

      if (total > 0) {
        return PROFILE_EMOTIONS.reduce((acc, emotion) => {
          acc[emotion] = mapped[emotion] / total;
          return acc;
        }, {} as EmotionVector);
      }
    }

    const eventEmotion = this.normalizeEmotion(event.finalEmotion);
    const oneHot = this.buildEmptyVector();
    if (eventEmotion) {
      oneHot[eventEmotion] = 1;
    }
    return oneHot;
  }

  private normalizeVector(
    value: Partial<Record<ProfileEmotion, number>> | undefined,
  ): EmotionVector {
    return PROFILE_EMOTIONS.reduce((acc, emotion) => {
      const raw = Number(value?.[emotion] ?? 0);
      acc[emotion] = Number.isFinite(raw) ? raw : 0;
      return acc;
    }, {} as EmotionVector);
  }

  private buildEmptyVector(): EmotionVector {
    return {
      joy: 0,
      sadness: 0,
      anger: 0,
      fear: 0,
      disgust: 0,
      surprise: 0,
      neutral: 0,
    };
  }

  private calculateEventNegativity(
    event: ProfileAggregateEvent,
    eventVector: EmotionVector,
  ): number {
    const scores = event.finalScores;
    if (scores && Object.keys(scores).length > 0) {
      let negative = 0;

      for (const [emotionRaw, scoreRaw] of Object.entries(scores)) {
        const emotion = this.normalizeEmotion(emotionRaw);
        if (!emotion || !NEGATIVE_FOR_SCORE.has(emotion)) {
          continue;
        }

        const score = Number(scoreRaw);
        if (!Number.isFinite(score) || score <= 0) {
          continue;
        }

        negative += score;
      }

      return this.clamp01(negative);
    }

    return this.clamp01(
      Array.from(NEGATIVE_FOR_SCORE).reduce(
        (acc, emotion) => acc + eventVector[emotion],
        0,
      ),
    );
  }

  private applyTimeDecay(
    previousValue: number,
    previousAt: Date | undefined,
    currentAt: Date,
    tauMs: number,
  ): number {
    if (!previousAt) {
      return previousValue;
    }

    const deltaMs = Math.max(0, currentAt.getTime() - previousAt.getTime());
    const decay = Math.exp(-deltaMs / tauMs);
    return previousValue * decay;
  }

  private applyStreakDecay(
    streak: number,
    previousAt: Date | undefined,
    currentAt: Date,
  ): number {
    const decayed = this.applyTimeDecay(
      streak,
      previousAt,
      currentAt,
      this.streakTauMs,
    );

    if (!previousAt) {
      return this.clampNonNegative(decayed);
    }

    const inactivityMs = Math.max(
      0,
      currentAt.getTime() - previousAt.getTime(),
    );
    const withSoftReset =
      inactivityMs > this.streakSoftResetMs
        ? decayed * this.streakSoftResetFactor
        : decayed;

    return this.clampNonNegative(withSoftReset);
  }

  private calculateVectorDistance(
    currentVector: EmotionVector,
    previousVector: EmotionVector,
  ): number {
    return PROFILE_EMOTIONS.reduce((acc, emotion) => {
      return acc + Math.abs(currentVector[emotion] - previousVector[emotion]);
    }, 0);
  }

  private clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private clampNonNegative(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Number(value.toFixed(4)));
  }

  private clampSigned(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(-1, Math.min(1, Number(value.toFixed(4))));
  }

  private normalizeEmotion(value?: string): ProfileEmotion | null {
    if (!value) {
      return null;
    }

    const key = value.toLowerCase();
    const map: Record<string, ProfileEmotion> = {
      joy: 'joy',
      happy: 'joy',
      sadness: 'sadness',
      sad: 'sadness',
      anger: 'anger',
      angry: 'anger',
      fear: 'fear',
      fearful: 'fear',
      disgust: 'disgust',
      disgusted: 'disgust',
      surprise: 'surprise',
      surprised: 'surprise',
      neutral: 'neutral',
    };

    return map[key] ?? null;
  }
}

function loadEmotionIntelligenceEnv(): string {
  for (const envFile of ENV_CANDIDATES) {
    if (!existsSync(envFile)) {
      continue;
    }

    dotenv.config({ path: envFile });

    if (process.env.MONGODB_URI) {
      return envFile;
    }
  }

  throw new Error(
    'Unable to find MONGODB_URI. Expected apps/emotion-intelligence-service/.env or .env.local',
  );
}

function loadGeneratedUsers(): GeneratedUserRow[] {
  const content = readFileSync(USERS_FILE, 'utf-8');
  const parsed = JSON.parse(content) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('generated-users.json must contain an array of users');
  }
  return parsed as GeneratedUserRow[];
}

function randomBehavior(): EmotionBehaviorProfile {
  const rand = Math.random();

  if (rand < 0.85) return 'positive';
  if (rand < 0.95) return 'downward';
  return 'negative';
}

function buildSeedUsers(): SeedUser[] {
  return loadGeneratedUsers()
    .slice(3)
    .map((user) => ({
      ...user,
      behavior: randomBehavior(),
    }));
}

function resolveRiskHintLevel(scores: Record<LowCaseEmotion, number>): string {
  const negativeRatio =
    (scores[LowCaseEmotion.SADNESS] ?? 0) +
    (scores[LowCaseEmotion.ANGER] ?? 0) +
    (scores[LowCaseEmotion.FEAR] ?? 0);

  if (negativeRatio >= 0.7) return 'HIGH';
  if (negativeRatio >= 0.45) return 'MEDIUM';
  return 'LOW';
}

function toAnalysisPayload(generated: {
  userId: string;
  targetId: string;
  finalEmotion: LowCaseEmotion;
  finalConfidence: number;
  scores: Record<LowCaseEmotion, number>;
  createdAt: Date;
}): AnalyticsSeedDoc {
  return {
    userId: generated.userId,
    targetId: generated.targetId,
    targetType: TargetType.POST,
    modelVersion: 'v1.0.1',
    finalEmotion: generated.finalEmotion,
    finalScores: generated.scores,
    finalConfidence: generated.finalConfidence,
    riskHintLevel: resolveRiskHintLevel(generated.scores),
    createdAt: generated.createdAt,
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be greater than 0');
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function shouldRecompute(
  lastCreatedAt: Date | undefined,
  now: Date,
  requiredHours: number,
): boolean {
  if (!lastCreatedAt) {
    return true;
  }

  const diffHours =
    (now.getTime() - new Date(lastCreatedAt).getTime()) / (1000 * 60 * 60);

  return diffHours >= requiredHours;
}

function buildAggregateEvents(
  analyticsDocs: AnalyticsSeedDoc[],
): SnapshotAggregateEvent[] {
  return analyticsDocs.map((doc) => ({
    createdAt: doc.createdAt,
    finalEmotion: doc.finalEmotion,
    finalScores: doc.finalScores,
  }));
}

function buildProfileEvents(
  analyticsDocs: AnalyticsSeedDoc[],
): ProfileAggregateEvent[] {
  return analyticsDocs.map((doc) => ({
    createdAt: doc.createdAt,
    finalEmotion: doc.finalEmotion,
    finalScores: doc.finalScores,
  }));
}

async function recomputeSnapshotsForUser(
  userId: string,
  referenceTime: Date,
  analyticsDocs: AnalyticsSeedDoc[],
  snapshotService: LocalSnapshotCalculator,
  snapshotCollection: any,
  latestSnapshotsByWindow: Map<
    EmotionTimeWindow,
    UserEmotionSnapshotSeedDoc | null
  >,
): Promise<UserEmotionSnapshotSeedDoc[]> {
  const since1d = new Date(referenceTime.getTime() - 1 * 24 * 60 * 60 * 1000);
  const since7d = new Date(referenceTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since30d = new Date(referenceTime.getTime() - 30 * 24 * 60 * 60 * 1000);

  const previous1d =
    latestSnapshotsByWindow.get(EmotionTimeWindow.ONE_DAY) ?? null;
  const previous7d =
    latestSnapshotsByWindow.get(EmotionTimeWindow.SEVEN_DAYS) ?? null;
  const previous30d =
    latestSnapshotsByWindow.get(EmotionTimeWindow.THIRTY_DAYS) ?? null;

  const shouldCompute7d = shouldRecompute(
    previous7d?.createdAt,
    referenceTime,
    6,
  );
  const shouldCompute30d = shouldRecompute(
    previous30d?.createdAt,
    referenceTime,
    24,
  );

  let querySince = since1d;
  if (shouldCompute30d) {
    querySince = since30d;
  } else if (shouldCompute7d) {
    querySince = since7d;
  }

  const aggregates = buildAggregateEvents(
    analyticsDocs.filter(
      (doc) => doc.createdAt >= querySince && doc.createdAt <= referenceTime,
    ),
  );

  const aggregates1d = aggregates.filter(
    (aggregate) => aggregate.createdAt >= since1d,
  );
  const aggregates7d = shouldCompute7d
    ? aggregates.filter((aggregate) => aggregate.createdAt >= since7d)
    : [];
  const aggregates30d = shouldCompute30d ? aggregates : [];

  const snapshotsToInsert: UserEmotionSnapshotSeedDoc[] = [];

  const snapshot1d = snapshotService.computeSnapshot(
    userId,
    EmotionTimeWindow.ONE_DAY,
    aggregates1d,
    previous1d,
    referenceTime,
  );

  snapshotsToInsert.push({
    ...snapshot1d,
    updatedAt: snapshot1d.createdAt,
  });
  latestSnapshotsByWindow.set(
    EmotionTimeWindow.ONE_DAY,
    snapshotsToInsert[snapshotsToInsert.length - 1] ?? null,
  );

  if (shouldCompute7d) {
    const snapshot7d = snapshotService.computeSnapshot(
      userId,
      EmotionTimeWindow.SEVEN_DAYS,
      aggregates7d,
      previous7d,
      referenceTime,
    );

    snapshotsToInsert.push({
      ...snapshot7d,
      updatedAt: snapshot7d.createdAt,
    });
    latestSnapshotsByWindow.set(
      EmotionTimeWindow.SEVEN_DAYS,
      snapshotsToInsert[snapshotsToInsert.length - 1] ?? null,
    );
  }

  if (shouldCompute30d) {
    const snapshot30d = snapshotService.computeSnapshot(
      userId,
      EmotionTimeWindow.THIRTY_DAYS,
      aggregates30d,
      previous30d,
      referenceTime,
    );

    snapshotsToInsert.push({
      ...snapshot30d,
      updatedAt: snapshot30d.createdAt,
    });
    latestSnapshotsByWindow.set(
      EmotionTimeWindow.THIRTY_DAYS,
      snapshotsToInsert[snapshotsToInsert.length - 1] ?? null,
    );
  }

  if (snapshotsToInsert.length > 0) {
    await snapshotCollection.insertMany(snapshotsToInsert, { ordered: false });
  }

  return snapshotsToInsert;
}

async function buildProfileForUser(
  userId: string,
  analyticsDocs: AnalyticsSeedDoc[],
  profileService: LocalProfileCalculator,
  profileCollection: any,
  referenceTime: Date,
): Promise<void> {
  const events = buildProfileEvents(
    analyticsDocs
      .slice()
      .sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      ),
  );

  if (events.length === 0) {
    return;
  }

  const updateResult = profileService.applyEventLevelUpdate(
    undefined,
    0,
    events,
    0,
    undefined,
    undefined,
    0,
  );

  const profileDoc: UserEmotionProfileSeedDoc = {
    userId,
    emotionVectorEMA: updateResult.emotionVectorEMA,
    recentNegativityScore: updateResult.recentNegativityScore,
    negativeEventStreak: updateResult.negativeEventStreak,
    lastEventAt: updateResult.lastEventAt,
    lastStrongNegativeAt: updateResult.lastStrongNegativeAt,
    emotionMomentum: updateResult.emotionMomentum,
    updatedAt: referenceTime,
  };

  await profileCollection.updateOne(
    { userId },
    { $set: profileDoc },
    { upsert: true },
  );
}

async function main(): Promise<void> {
  const envFile = loadEmotionIntelligenceEnv();
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error(`MONGODB_URI is missing after loading ${envFile}`);
  }

  const now = new Date();
  const days = 3;
  const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const seedAnchor = now.getTime();
  const batchSize = 200;

  const seedUsers = buildSeedUsers();
  const emotionGenerator = new EmotionGenerator();
  const timelineGenerator = new TimelineGenerator();
  const snapshotService = new LocalSnapshotCalculator();
  const profileService = new LocalProfileCalculator();

  const mongooseInstance = await mongoose.connect(mongoUri, {
    dbName: 'emotion_intelligence_service',
  });

  try {
    const db = mongooseInstance.connection.db;

    if (!db) {
      throw new Error('MongoDB connection did not expose a database handle');
    }

    const analyticsCollection = db.collection('emotion_analytics_snapshots');
    const snapshotCollection = db.collection('user_emotion_snapshots');
    const profileCollection = db.collection('user_emotion_profiles');

    await Promise.all([
      analyticsCollection.deleteMany({}),
      snapshotCollection.deleteMany({}),
      profileCollection.deleteMany({}),
    ]);

    const analyticsByUser = new Map<string, AnalyticsSeedDoc[]>();

    for (const seedUser of seedUsers) {
      const userRandom = createSeededRandom(`${seedAnchor}:${seedUser.userId}`);
      const eventCount = userRandom.nextInt(20, 40);

      const timeline = timelineGenerator.buildTimeline({
        userId: seedUser.userId,
        startTime,
        endTime: now,
        eventCount,
        random: userRandom,
      });

      const userAnalytics = timeline.map((point, index) => {
        const generated = emotionGenerator.generateEvent({
          userId: seedUser.userId,
          behavior: seedUser.behavior,
          createdAt: point.createdAt,
          index,
          totalEvents: timeline.length,
          random: point.random,
        });

        return toAnalysisPayload(generated);
      });

      analyticsByUser.set(seedUser.userId, userAnalytics);

      for (const chunk of chunkArray(userAnalytics, batchSize)) {
        await analyticsCollection.insertMany(chunk, { ordered: false });
      }

      console.log(
        `Seeded emotion analytics for ${seedUser.userId}: ${userAnalytics.length} events`,
      );
    }

    for (const seedUser of seedUsers) {
      const userAnalytics = analyticsByUser.get(seedUser.userId) ?? [];
      const earliestEvent = userAnalytics[0]?.createdAt;

      if (!earliestEvent) {
        continue;
      }

      const backfillStart = new Date(
        earliestEvent.getTime() + 24 * 60 * 60 * 1000,
      );
      const latestSnapshotsByWindow = new Map<
        EmotionTimeWindow,
        UserEmotionSnapshotSeedDoc | null
      >([
        [EmotionTimeWindow.ONE_DAY, null],
        [EmotionTimeWindow.SEVEN_DAYS, null],
        [EmotionTimeWindow.THIRTY_DAYS, null],
      ]);

      let cursor = new Date(backfillStart);

      while (cursor <= now) {
        await recomputeSnapshotsForUser(
          seedUser.userId,
          new Date(cursor),
          userAnalytics,
          snapshotService,
          snapshotCollection,
          latestSnapshotsByWindow,
        );

        cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
      }

      await buildProfileForUser(
        seedUser.userId,
        userAnalytics,
        profileService,
        profileCollection,
        now,
      );

      console.log(`Backfilled snapshots and profile for ${seedUser.userId}`);
    }

    console.log(
      `Seed completed for emotion-intelligence-service using ${envFile}`,
    );
  } finally {
    await mongooseInstance.disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[seed-emotion-intelligence-service] ${message}`);
  process.exitCode = 1;
});
