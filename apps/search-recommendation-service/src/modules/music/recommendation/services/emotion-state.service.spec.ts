import { EmotionState, EmotionStateService } from './emotion-state.service';
import { RiskLevel } from '@repo/dtos';

describe('EmotionStateService', () => {
  let service: EmotionStateService;

  beforeEach(() => {
    service = new EmotionStateService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('TC-MUS-02: Emotion State Classification & Risk Overrides', () => {
    it('should classify as STRESS when risk is HIGH_RISK regardless of valence/arousal', () => {
      const state = service.classify(0.9, 0.2, RiskLevel.HIGH_RISK);
      expect(state).toBe(EmotionState.STRESS);
    });

    it('should classify as STRESS when risk is CRISIS regardless of valence/arousal', () => {
      const state = service.classify(0.8, 0.5, RiskLevel.CRISIS);
      expect(state).toBe(EmotionState.STRESS);
    });

    it('should classify as ANGRY when valence < 0.4 and arousal > 0.7', () => {
      const state = service.classify(0.2, 0.85, RiskLevel.NORMAL);
      expect(state).toBe(EmotionState.ANGRY);
    });

    it('should classify as SAD when valence < 0.4 and arousal < 0.3', () => {
      const state = service.classify(0.2, 0.2, RiskLevel.NORMAL);
      expect(state).toBe(EmotionState.SAD);
    });

    it('should classify as STRESS when valence < 0.4 and arousal is mid (0.3 - 0.7)', () => {
      const state = service.classify(0.3, 0.5, RiskLevel.NORMAL);
      expect(state).toBe(EmotionState.STRESS);
    });

    it('should classify as CALM when valence > 0.65 and arousal < 0.4', () => {
      const state = service.classify(0.8, 0.2, RiskLevel.NORMAL);
      expect(state).toBe(EmotionState.CALM);
    });

    it('should classify as NEUTRAL when valence > 0.65 and arousal >= 0.4', () => {
      const state = service.classify(0.7, 0.6, RiskLevel.NORMAL);
      expect(state).toBe(EmotionState.NEUTRAL);
    });

    it('should classify as CALM in mid valence (0.4 - 0.65) when arousal < 0.35', () => {
      const state = service.classify(0.5, 0.2, RiskLevel.NORMAL);
      expect(state).toBe(EmotionState.CALM);
    });

    it('should classify as ANGRY in mid valence (0.4 - 0.65) when arousal > 0.7', () => {
      const state = service.classify(0.5, 0.8, RiskLevel.NORMAL);
      expect(state).toBe(EmotionState.ANGRY);
    });

    it('should classify as NEUTRAL in mid valence with mid arousal', () => {
      const state = service.classify(0.5, 0.5, RiskLevel.NORMAL);
      expect(state).toBe(EmotionState.NEUTRAL);
    });
  });
});
