import { ProfileService } from './profile.service';
import { EmotionVector, ProfileAggregateEvent } from './profile.schema';

describe('ProfileService', () => {
  let service: ProfileService;

  beforeEach(() => {
    service = new ProfileService();
  });

  describe('applyEventLevelUpdate - EMA Calculations (TC-EI-01)', () => {
    it('should correctly update emotion vector EMA with alpha = 0.2', () => {
      const previousEma: Partial<EmotionVector> = {
        joy: 0.5,
        sadness: 0.1,
        anger: 0.0,
        fear: 0.0,
        disgust: 0.0,
        surprise: 0.0,
        neutral: 0.4,
      };

      const now = new Date('2026-11-06T10:00:00Z');
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-1',
          userId: 'user-123',
          finalEmotion: 'joy',
          finalScores: {
            joy: 1.0,
            sadness: 0,
            anger: 0,
            fear: 0,
            disgust: 0,
            surprise: 0,
            neutral: 0,
          },
          createdAt: now,
        },
      ];

      const result = service.applyEventLevelUpdate(
        previousEma,
        0.2,
        events,
        0,
        now,
      );

      // EMA_joy = 0.2 * 1.0 + 0.8 * 0.5 = 0.60
      expect(result.emotionVectorEMA.joy).toBeCloseTo(0.6, 4);
      // EMA_sadness = 0.2 * 0.0 + 0.8 * 0.1 = 0.08
      expect(result.emotionVectorEMA.sadness).toBeCloseTo(0.08, 4);
      // EMA_neutral = 0.2 * 0.0 + 0.8 * 0.4 = 0.32
      expect(result.emotionVectorEMA.neutral).toBeCloseTo(0.32, 4);
      // Sum should be 1.0
      const sum = Object.values(result.emotionVectorEMA).reduce(
        (a, b) => a + b,
        0,
      );
      expect(sum).toBeCloseTo(1.0, 4);
    });

    it('should fall back to one-hot vector if finalScores are empty', () => {
      const now = new Date('2026-11-06T10:00:00Z');
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-2',
          userId: 'user-123',
          finalEmotion: 'sadness',
          createdAt: now,
        },
      ];

      const result = service.applyEventLevelUpdate(undefined, 0, events);

      // Initial state was 0, so 0.2 * 1.0 = 0.2 for sadness
      expect(result.emotionVectorEMA.sadness).toBeCloseTo(0.2, 4);
      expect(result.emotionVectorEMA.joy).toBe(0);
    });
  });

  describe('applyEventLevelUpdate - Time Decay (TC-EI-02)', () => {
    it('should apply exponential time decay to recentNegativityScore (tau = 8h)', () => {
      const t0 = new Date('2026-11-06T00:00:00Z');
      // Exactly 8 hours later
      const t1 = new Date('2026-11-06T08:00:00Z');

      const initialNegativity = 0.8;
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-decay',
          userId: 'user-123',
          finalEmotion: 'joy',
          finalScores: { joy: 1.0 },
          createdAt: t1,
        },
      ];

      const result = service.applyEventLevelUpdate(
        undefined,
        initialNegativity,
        events,
        0,
        t0,
      );

      // Decay factor = exp(-8h / 8h) = exp(-1) ≈ 0.367879
      // Decayed negativity = 0.8 * 0.367879 ≈ 0.2943
      // Since event is pure joy, eventNegativity = 0
      // recentNegativity = decayed + 0 * (1 - decayed) = decayed ≈ 0.2943
      expect(result.recentNegativityScore).toBeCloseTo(0.8 * Math.exp(-1), 3);
      expect(result.lastEventAt).toEqual(t1);
    });
  });

  describe('applyEventLevelUpdate - Streak Tracking (TC-EI-03 & TC-EI-04)', () => {
    it('should increment negativeEventStreak when eventNegativity >= 0.55', () => {
      const now = new Date('2026-11-06T12:00:00Z');
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-neg-1',
          userId: 'user-123',
          finalEmotion: 'sadness',
          finalScores: { sadness: 0.8, joy: 0.1 },
          createdAt: now,
        },
      ];

      const result = service.applyEventLevelUpdate(
        undefined,
        0,
        events,
        2, // starting streak of 2
        now,
      );

      // Streak should increase from 2 to 3
      expect(result.negativeEventStreak).toBe(3);
    });

    it('should decrement negativeEventStreak when eventNegativity <= 0.35', () => {
      const now = new Date('2026-11-06T12:00:00Z');
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-pos-1',
          userId: 'user-123',
          finalEmotion: 'joy',
          finalScores: { joy: 0.9, sadness: 0.0 },
          createdAt: now,
        },
      ];

      const result = service.applyEventLevelUpdate(
        undefined,
        0.5,
        events,
        3, // starting streak of 3
        now,
      );

      // Streak should decrement from 3 to 2
      expect(result.negativeEventStreak).toBe(2);
    });

    it('should partially decrement negativeEventStreak by 0.5 in neutral zone (0.35 < negativity < 0.55)', () => {
      const now = new Date('2026-11-06T12:00:00Z');
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-neutral-zone',
          userId: 'user-123',
          finalEmotion: 'neutral',
          finalScores: { sadness: 0.45, joy: 0.55 }, // negativity = 0.45
          createdAt: now,
        },
      ];

      const result = service.applyEventLevelUpdate(
        undefined,
        0.5,
        events,
        2,
        now,
      );

      // In neutral zone, streak decays by 0.5: 2 - 0.5 = 1.5
      expect(result.negativeEventStreak).toBe(1.5);
    });

    it('should apply soft reset factor (0.3) when inactivity > 24 hours', () => {
      const t0 = new Date('2026-11-04T00:00:00Z');
      const t1 = new Date('2026-11-05T06:00:00Z'); // 30 hours later (> 24h)

      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-neutral',
          userId: 'user-123',
          finalEmotion: 'neutral',
          finalScores: { neutral: 1.0 },
          createdAt: t1,
        },
      ];

      const initialStreak = 4;
      const result = service.applyEventLevelUpdate(
        undefined,
        0.5,
        events,
        initialStreak,
        t0,
      );

      // deltaMs = 30h, streakTauMs = 12h
      // decayed = 4 * exp(-30 / 12) = 4 * exp(-2.5) ≈ 0.3283
      // withSoftReset = decayed * 0.3 ≈ 0.0985
      // eventNegativity is 0, so streak drops by 1 -> clamped to 0
      expect(result.negativeEventStreak).toBe(0);
    });
  });

  describe('applyEventLevelUpdate - Emotion Momentum (TC-EI-05)', () => {
    it('should increase emotionMomentum when rapid vector shifts occur', () => {
      const now = new Date('2026-11-06T12:00:00Z');
      // Previous state: full joy
      const previousEma: Partial<EmotionVector> = { joy: 1.0 };

      // Sudden drastic shift to pure anger
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-shift',
          userId: 'user-123',
          finalEmotion: 'anger',
          finalScores: { anger: 1.0 },
          createdAt: now,
        },
      ];

      const result = service.applyEventLevelUpdate(
        previousEma,
        0,
        events,
        0,
        now,
        undefined,
        0, // previous momentum
      );

      // Vector shifted significantly, so momentum should be positive
      expect(result.emotionMomentum).toBeGreaterThan(0.2);
      expect(result.emotionMomentum).toBeLessThanOrEqual(1.0);
    });
  });

  describe('applyEventLevelUpdate - Strong Negative Timestamp', () => {
    it('should update lastStrongNegativeAt when negativity >= 0.7', () => {
      const t0 = new Date('2026-11-06T10:00:00Z');
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-severe',
          userId: 'user-123',
          finalEmotion: 'sadness',
          finalScores: { sadness: 0.9 },
          createdAt: t0,
        },
      ];

      const result = service.applyEventLevelUpdate(
        undefined,
        0,
        events,
        0,
        undefined,
        undefined,
      );

      expect(result.lastStrongNegativeAt).toEqual(t0);
    });

    it('should retain previous lastStrongNegativeAt if event is not strong negative', () => {
      const tPrev = new Date('2026-11-05T10:00:00Z');
      const tCurr = new Date('2026-11-06T10:00:00Z');
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-mild',
          userId: 'user-123',
          finalEmotion: 'joy',
          finalScores: { joy: 0.9 },
          createdAt: tCurr,
        },
      ];

      const result = service.applyEventLevelUpdate(
        undefined,
        0,
        events,
        0,
        tPrev,
        tPrev,
      );

      expect(result.lastStrongNegativeAt).toEqual(tPrev);
    });
  });

  describe('Edge Cases and Normalization', () => {
    it('should handle invalid scores, unknown emotions, and non-finite values safely', () => {
      const now = new Date('2026-11-06T10:00:00Z');
      const events: ProfileAggregateEvent[] = [
        {
          eventId: 'evt-edge',
          userId: 'user-123',
          finalEmotion: '',
          finalScores: {
            unknown_emotion: 0.5,
            sadness: -1, // invalid negative score
            joy: NaN, // NaN score
            anger: 0.8,
          } as any,
          createdAt: now,
        },
      ];

      const result = service.applyEventLevelUpdate(
        { joy: NaN } as any,
        NaN,
        events,
        NaN,
        undefined,
        undefined,
        NaN,
      );

      expect(result.emotionVectorEMA.anger).toBeGreaterThan(0);
      expect(Number.isFinite(result.recentNegativityScore)).toBe(true);
      expect(Number.isFinite(result.negativeEventStreak)).toBe(true);
      expect(Number.isFinite(result.emotionMomentum)).toBe(true);
    });
  });
});
