import { Injectable } from '@nestjs/common';
import { LowCaseEmotion } from '@repo/dtos';

const EMOTION_WEIGHTS: Record<
  LowCaseEmotion,
  { valence: number; arousal: number }
> = {
  [LowCaseEmotion.JOY]: { valence: 0.9, arousal: 0.7 },
  [LowCaseEmotion.SADNESS]: { valence: 0.1, arousal: 0.3 },
  [LowCaseEmotion.ANGER]: { valence: 0.15, arousal: 0.9 },
  [LowCaseEmotion.FEAR]: { valence: 0.2, arousal: 0.8 },
  [LowCaseEmotion.DISGUST]: { valence: 0.2, arousal: 0.6 },
  [LowCaseEmotion.SURPRISE]: { valence: 0.6, arousal: 0.75 },
  [LowCaseEmotion.NEUTRAL]: { valence: 0.5, arousal: 0.5 },
};

const DEFAULT_VALENCE = 0.5;
const DEFAULT_AROUSAL = 0.5;
const MIN_SIGNAL_TOTAL = 1e-6;

@Injectable()
export class EmotionMappingService {
  toValenceArousal(emotionVector: Record<string, number>): {
    valence: number;
    arousal: number;
  } {
    const normalized = this.normalizeEmotionVector(emotionVector);

    let valence = 0;
    let arousal = 0;

    for (const [emotion, score] of Object.entries(normalized)) {
      const weights = EMOTION_WEIGHTS[emotion as LowCaseEmotion];
      if (!weights) continue;

      valence += score * weights.valence;
      arousal += score * weights.arousal;
    }

    const hasMappedEmotion = Object.keys(normalized).some(
      (emotion) => EMOTION_WEIGHTS[emotion as LowCaseEmotion] !== undefined,
    );

    if (!hasMappedEmotion) {
      return { valence: DEFAULT_VALENCE, arousal: DEFAULT_AROUSAL };
    }

    return {
      valence: this.clamp01(valence),
      arousal: this.clamp01(arousal),
    };
  }

  private normalizeEmotionVector(
    vector: Record<string, number>,
  ): Record<string, number> {
    const safeVector = vector ?? {};
    const total = Object.values(safeVector).reduce((sum, value) => {
      const numericValue = Number(value);
      return (
        sum + (Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0)
      );
    }, 0);

    if (total <= MIN_SIGNAL_TOTAL) {
      return { [LowCaseEmotion.NEUTRAL]: 1 };
    }

    const normalized: Record<string, number> = {};
    for (const [emotion, value] of Object.entries(safeVector)) {
      const numericValue = Number(value);
      normalized[emotion] = Number.isFinite(numericValue)
        ? Math.max(0, numericValue) / total
        : 0;
    }

    return normalized;
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }
}
