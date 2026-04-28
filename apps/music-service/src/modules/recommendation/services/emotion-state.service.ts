import { Injectable } from '@nestjs/common';
import { RiskLevel } from '@repo/dtos';

const LOW_VALENCE_THRESHOLD = 0.4;
const HIGH_AROUSAL_THRESHOLD = 0.65;
const LOW_AROUSAL_THRESHOLD = 0.35;
const MODERATE_VALENCE_THRESHOLD = 0.5;

export enum EmotionState {
  STRESS = 'STRESS',
  SAD = 'SAD',
  ANGRY = 'ANGRY',
  CALM = 'CALM',
  NEUTRAL = 'NEUTRAL',
}

@Injectable()
export class EmotionStateService {
  classify(valence: number, arousal: number, risk: RiskLevel): EmotionState {
    // Ưu tiên risk
    if (risk >= RiskLevel.HIGH) return EmotionState.STRESS;

    // ===== LOW VALENCE ZONE =====
    if (valence < 0.4) {
      if (arousal > 0.7) return EmotionState.ANGRY;
      if (arousal < 0.3) return EmotionState.SAD;
      return EmotionState.STRESS;
    }

    // ===== HIGH VALENCE ZONE =====
    if (valence > 0.65) {
      if (arousal < 0.4) return EmotionState.CALM;
      return EmotionState.NEUTRAL; // vui nhưng kích thích → không hẳn calm
    }

    // ===== MID ZONE =====
    if (arousal < 0.35) return EmotionState.CALM;
    if (arousal > 0.7) return EmotionState.ANGRY;

    return EmotionState.NEUTRAL;
  }
}
