import { Injectable } from '@nestjs/common';
import { EmotionTimeWindow } from '@repo/dtos';
import { UserEmotionSnapshot } from 'src/mongo/schema/emotion-snapshot.schema';
import {
  EmotionDistribution,
  SnapshotAggregateEvent,
  SnapshotEmotion,
  SnapshotPayload,
  SNAPSHOT_EMOTIONS,
} from './snapshot.schema';

const NEGATIVE_FOR_RATIO: ReadonlySet<SnapshotEmotion> = new Set([
  'sadness',
  'anger',
  'fear',
]);

@Injectable()
export class SnapshotService {
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
      UserEmotionSnapshot,
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
          UserEmotionSnapshot,
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
      negativeRatio,
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

        distribution[emotion] += score;
        total += score;
      }

      if (total > 0) {
        return this.normalizeDistribution(distribution, total);
      }
    }

    const oneHot = this.buildEmptyDistribution();
    const finalEmotion = aggregate.finalEmotion;
    if (finalEmotion) {
      oneHot[finalEmotion] = 1;
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
    const baselineGap = this.clamp01(
      Math.max(0, nonlinearNegativity - baseline),
    );

    const weighted =
      0.5 * nonlinearNegativity +
      0.2 * volatility +
      0.15 * trendUp +
      0.15 * baselineGap;

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
