import { LowCaseEmotion } from '@repo/dtos';
import { TimelineRandom } from './timeline.generator';

export type EmotionBehaviorProfile = 'positive' | 'downward' | 'negative';

export interface GeneratedEmotionEvent {
  userId: string;
  targetId: string;
  finalEmotion: LowCaseEmotion;
  finalConfidence: number;
  scores: Record<LowCaseEmotion, number>;
  createdAt: Date;
}

export interface EmotionGenerationOptions {
  userId: string;
  behavior: EmotionBehaviorProfile;
  createdAt: Date;
  index: number;
  totalEvents: number;
  random: TimelineRandom;
}

const EMOTIONS: LowCaseEmotion[] = [
  LowCaseEmotion.JOY,
  LowCaseEmotion.SADNESS,
  LowCaseEmotion.ANGER,
  LowCaseEmotion.FEAR,
  LowCaseEmotion.DISGUST,
  LowCaseEmotion.SURPRISE,
  LowCaseEmotion.NEUTRAL,
];

export class EmotionGenerator {
  generateEvent(options: EmotionGenerationOptions): GeneratedEmotionEvent {
    const phase =
      options.totalEvents <= 1 ? 0 : options.index / (options.totalEvents - 1);
    const weights = this.buildWeights(options.behavior, phase, options.random);
    const scores = this.normalize(weights);
    const finalEmotion = this.pickDominantEmotion(scores);
    const finalConfidence = this.buildConfidence(scores, options.random);

    return {
      userId: options.userId,
      targetId: `analysis-${options.userId.slice(-8)}-${options.index + 1}-${options.createdAt.getTime()}`,
      finalEmotion,
      finalConfidence,
      scores,
      createdAt: options.createdAt,
    };
  }

  private buildWeights(
    behavior: EmotionBehaviorProfile,
    phase: number,
    random: TimelineRandom,
  ): Record<LowCaseEmotion, number> {
    const noise = () => random.nextFloat(0.01, 0.08);

    if (behavior === 'positive') {
      return {
        joy: 0.48 + noise(),
        sadness: 0.02 + noise() * 0.25,
        anger: 0.02 + noise() * 0.25,
        fear: 0.02 + noise() * 0.2,
        disgust: 0.03 + noise() * 0.2,
        surprise: 0.08 + noise() * 0.4,
        neutral: 0.22 + noise() * 0.5,
      };
    }

    if (behavior === 'downward') {
      const joyWeight = Math.max(0.08, 0.42 - phase * 0.22);
      const sadnessWeight = Math.min(0.44, 0.12 + phase * 0.2);
      const angerWeight = Math.min(0.34, 0.05 + phase * 0.18);
      const fearWeight = Math.min(0.26, 0.04 + phase * 0.12);

      return {
        joy: joyWeight + noise(),
        sadness: sadnessWeight + noise(),
        anger: angerWeight + noise() * 0.9,
        fear: fearWeight + noise() * 0.8,
        disgust: 0.04 + noise() * 0.4,
        surprise: 0.06 + noise() * 0.3,
        neutral: 0.18 + (1 - phase) * 0.1 + noise() * 0.4,
      };
    }

    return {
      joy: 0.06 + noise() * 0.3,
      sadness: 0.34 + phase * 0.18 + noise(),
      anger: 0.2 + phase * 0.12 + noise(),
      fear: 0.22 + phase * 0.12 + noise(),
      disgust: 0.08 + noise() * 0.5,
      surprise: 0.03 + noise() * 0.2,
      neutral: 0.07 + noise() * 0.25,
    };
  }

  private normalize(
    weights: Record<LowCaseEmotion, number>,
  ): Record<LowCaseEmotion, number> {
    const total = EMOTIONS.reduce(
      (sum, emotion) => sum + Math.max(0, weights[emotion]),
      0,
    );
    const denominator = total > 0 ? total : 1;

    return EMOTIONS.reduce(
      (acc, emotion) => {
        acc[emotion] = Number(
          (Math.max(0, weights[emotion]) / denominator).toFixed(4),
        );
        return acc;
      },
      {} as Record<LowCaseEmotion, number>,
    );
  }

  private pickDominantEmotion(
    scores: Record<LowCaseEmotion, number>,
  ): LowCaseEmotion {
    let dominantEmotion = LowCaseEmotion.NEUTRAL;
    let dominantScore = -Infinity;

    for (const emotion of EMOTIONS) {
      const score = scores[emotion] ?? 0;
      if (score > dominantScore) {
        dominantScore = score;
        dominantEmotion = emotion;
      }
    }

    return dominantEmotion;
  }

  private buildConfidence(
    scores: Record<LowCaseEmotion, number>,
    random: TimelineRandom,
  ): number {
    const topScore = Math.max(
      ...EMOTIONS.map((emotion) => scores[emotion] ?? 0),
    );
    const confidence = topScore + random.nextFloat(0.05, 0.16);
    return Number(Math.max(0.55, Math.min(0.99, confidence)).toFixed(3));
  }
}
