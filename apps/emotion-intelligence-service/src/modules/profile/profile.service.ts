import { Injectable } from '@nestjs/common';
import {
  EmotionVector,
  ProfileAggregateEvent,
  ProfileComputationResult,
  ProfileEmotion,
  PROFILE_EMOTIONS,
} from './profile.schema';

const NEGATIVE_FOR_SCORE: ReadonlySet<ProfileEmotion> = new Set([
  'sadness',
  'anger',
  'fear',
  'disgust',
]);

@Injectable()
export class ProfileService {
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
