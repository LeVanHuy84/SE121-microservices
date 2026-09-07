import { Injectable } from '@nestjs/common';
import { RiskLevel } from '@repo/dtos';

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
    if (risk === RiskLevel.HIGH_RISK || risk === RiskLevel.CRISIS)
      return EmotionState.STRESS;

    // ===== LOW VALENCE ZONE =====
    if (valence < 0.4) {
      if (arousal > 0.7) return EmotionState.ANGRY;
      if (arousal < 0.3) return EmotionState.SAD;
      return EmotionState.STRESS;
    }

    // ===== HIGH VALENCE ZONE =====
    if (valence > 0.65) {
      if (arousal < 0.4) return EmotionState.CALM;
      return EmotionState.NEUTRAL;
    }

    // ===== MID ZONE =====
    if (arousal < 0.35) return EmotionState.CALM;
    if (arousal > 0.7) return EmotionState.ANGRY;

    return EmotionState.NEUTRAL;
  }
}
