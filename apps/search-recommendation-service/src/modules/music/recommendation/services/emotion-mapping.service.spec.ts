import { EmotionMappingService } from './emotion-mapping.service';
import { LowCaseEmotion } from '@repo/dtos';

describe('EmotionMappingService', () => {
  let service: EmotionMappingService;

  beforeEach(() => {
    service = new EmotionMappingService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('TC-MUS-01: Multi-label Emotion Mapping to Valence & Arousal', () => {
    it('should map single pure JOY emotion to valence 0.9 and arousal 0.7', () => {
      const result = service.toValenceArousal({ [LowCaseEmotion.JOY]: 1.0 });
      expect(result.valence).toBeCloseTo(0.9, 2);
      expect(result.arousal).toBeCloseTo(0.7, 2);
    });

    it('should map single pure SADNESS emotion to valence 0.1 and arousal 0.3', () => {
      const result = service.toValenceArousal({
        [LowCaseEmotion.SADNESS]: 1.0,
      });
      expect(result.valence).toBeCloseTo(0.1, 2);
      expect(result.arousal).toBeCloseTo(0.3, 2);
    });

    it('should normalize unnormalized vector sum to 1.0 and compute blended valence/arousal', () => {
      // 2.0 JOY and 2.0 SADNESS -> normalized to 0.5 JOY and 0.5 SADNESS
      // valence = 0.5 * 0.9 + 0.5 * 0.1 = 0.5
      // arousal = 0.5 * 0.7 + 0.5 * 0.3 = 0.5
      const result = service.toValenceArousal({
        [LowCaseEmotion.JOY]: 2.0,
        [LowCaseEmotion.SADNESS]: 2.0,
      });

      expect(result.valence).toBeCloseTo(0.5, 2);
      expect(result.arousal).toBeCloseTo(0.5, 2);
    });

    it('should return default neutral (0.5, 0.5) when emotion vector is empty or zeros', () => {
      const result1 = service.toValenceArousal({});
      expect(result1.valence).toBe(0.5);
      expect(result1.arousal).toBe(0.5);

      const result2 = service.toValenceArousal({ [LowCaseEmotion.JOY]: 0 });
      expect(result2.valence).toBe(0.5);
      expect(result2.arousal).toBe(0.5);
    });

    it('should return default neutral (0.5, 0.5) when all emotions are unmapped keys', () => {
      const result = service.toValenceArousal({ unknown_custom_emotion: 1.0 });
      expect(result.valence).toBe(0.5);
      expect(result.arousal).toBe(0.5);
    });

    it('should clamp valence and arousal between 0 and 1', () => {
      const result = service.toValenceArousal({
        [LowCaseEmotion.JOY]: 100.0,
      });
      expect(result.valence).toBeLessThanOrEqual(1.0);
      expect(result.valence).toBeGreaterThanOrEqual(0.0);
      expect(result.arousal).toBeLessThanOrEqual(1.0);
      expect(result.arousal).toBeGreaterThanOrEqual(0.0);
    });
  });
});
