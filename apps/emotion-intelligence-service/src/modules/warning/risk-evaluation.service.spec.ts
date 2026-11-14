import 'reflect-metadata';
import { RiskLevel } from '@repo/dtos';
import { RiskEvaluationService } from './risk-evaluation.service';

describe('RiskEvaluationService', () => {
  let service: RiskEvaluationService;

  beforeEach(() => {
    service = new RiskEvaluationService();
  });

  describe('computeCandidateLevel', () => {
    it('should assign correct candidate level based on score ranges', () => {
      expect(service.computeCandidateLevel(RiskLevel.NORMAL, 0.1)).toBe(
        RiskLevel.NORMAL,
      );
      expect(service.computeCandidateLevel(RiskLevel.NORMAL, 0.35)).toBe(
        RiskLevel.MILD_STRESS,
      );
      expect(service.computeCandidateLevel(RiskLevel.NORMAL, 0.55)).toBe(
        RiskLevel.MODERATE_RISK,
      );
      expect(service.computeCandidateLevel(RiskLevel.NORMAL, 0.75)).toBe(
        RiskLevel.HIGH_RISK,
      );
      expect(service.computeCandidateLevel(RiskLevel.NORMAL, 0.9)).toBe(
        RiskLevel.CRISIS,
      );
    });
  });

  describe('computeNextLevel - Hysteresis & Upward Escalation (TC-EI-06 & TC-EI-07)', () => {
    it('should escalate upward when score exceeds enter threshold with previous satisfied (TC-EI-06)', () => {
      // Score escalates from 0.40 to 0.75 (enter HIGH_RISK threshold is 0.70)
      const nextLevel = service.computeNextLevel(
        RiskLevel.MODERATE_RISK,
        0.75, // current score >= 0.70
        0,
        0.72, // previous score also >= 0.70
      );

      expect(nextLevel).toBe(RiskLevel.HIGH_RISK);
    });

    it('should bypass stability upward when ignoreStableUpward is true', () => {
      const nextLevel = service.computeNextLevel(
        RiskLevel.NORMAL,
        0.88, // CRISIS enter is 0.85
        0,
        0.2, // previous was low
        true, // ignoreStableUpward
      );

      expect(nextLevel).toBe(RiskLevel.CRISIS);
    });

    it('should retain current level within hysteresis band to prevent flapping (TC-EI-07)', () => {
      // Current is HIGH_RISK. Exit threshold is < 0.60.
      // Score decreases to 0.65 (between exit 0.60 and enter 0.70).
      const nextLevel = service.computeNextLevel(
        RiskLevel.HIGH_RISK,
        0.65, // < 0.70, but NOT < 0.60
        0,
        0.65,
      );

      // Should remain HIGH_RISK due to hysteresis band
      expect(nextLevel).toBe(RiskLevel.HIGH_RISK);
    });
  });

  describe('computeNextLevel - Stable Windows De-escalation (TC-EI-08)', () => {
    it('should NOT de-escalate immediately on first window below exit threshold', () => {
      // Current is HIGH_RISK. Score drops to 0.55 (< 0.60 exit threshold).
      // But previous score was 0.75 (not satisfied in previous window).
      const nextLevel = service.computeNextLevel(
        RiskLevel.HIGH_RISK,
        0.55,
        0,
        0.75, // previous was above exit threshold
      );

      // Requires stableWindows >= 2, so should remain HIGH_RISK
      expect(nextLevel).toBe(RiskLevel.HIGH_RISK);
    });

    it('should de-escalate to candidate level once stable windows condition is met', () => {
      // Current is HIGH_RISK. Both current and previous scores are below exit threshold (< 0.60).
      const nextLevel = service.computeNextLevel(
        RiskLevel.HIGH_RISK,
        0.55, // candidate is MODERATE_RISK (0.50 - 0.70)
        1,
        0.54, // previous satisfied (< 0.60)
      );

      // 2 consecutive windows satisfied -> de-escalate to MODERATE_RISK
      expect(nextLevel).toBe(RiskLevel.MODERATE_RISK);
    });
  });

  describe('isSpike - Sudden Negativity Surge (TC-EI-09)', () => {
    it('should detect spike when score delta exceeds spikeThreshold (0.25)', () => {
      const isSpike = service.isSpike(null, 0.7, 0.4); // delta = 0.30 > 0.25
      expect(isSpike).toBe(true);
    });

    it('should detect spike when consecutiveNegativeDays >= 3', () => {
      const isSpike = service.isSpike(
        { consecutiveNegativeDays: 3 },
        0.5,
        0.45,
      );
      expect(isSpike).toBe(true);
    });

    it('should detect spike when high negativity and high momentum co-occur', () => {
      const isSpike = service.isSpike(
        {
          recentNegativityScore: 0.85,
          emotionMomentum: 0.65,
        },
        0.6,
        0.55,
      );
      expect(isSpike).toBe(true);
    });

    it('should return false when delta is small and no abnormal signals exist', () => {
      const isSpike = service.isSpike(
        {
          recentNegativityScore: 0.3,
          emotionMomentum: 0.1,
          consecutiveNegativeDays: 1,
        },
        0.4,
        0.35, // delta = 0.05
      );
      expect(isSpike).toBe(false);
    });
  });

  describe('applySpikeOverride', () => {
    it('should boost score by +0.15 and immediately promote level for low/moderate risk', () => {
      // NORMAL with score 0.40 -> boosted to 0.55 (MODERATE_RISK candidate >= 0.50)
      const overriddenLevel = service.applySpikeOverride(
        RiskLevel.NORMAL,
        0.4,
        0,
        0.2,
      );

      expect(overriddenLevel).toBe(RiskLevel.MODERATE_RISK);
    });

    it('should ignore spike override if user is already HIGH_RISK or CRISIS', () => {
      const level = service.applySpikeOverride(
        RiskLevel.HIGH_RISK,
        0.72,
        2,
        0.7,
      );

      expect(level).toBe(RiskLevel.HIGH_RISK);
    });
  });

  describe('shouldNotify - Cooldown Mechanism', () => {
    it('should allow notification on first upward transition without prior notification', () => {
      const shouldNotify = service.shouldNotify(
        RiskLevel.NORMAL,
        RiskLevel.HIGH_RISK,
        new Date('2026-11-06T10:00:00Z'),
        undefined,
      );

      expect(shouldNotify).toBe(true);
    });

    it('should block notification if within 12h cooldown window', () => {
      const t0 = new Date('2026-11-06T10:00:00Z');
      const t1 = new Date('2026-11-06T14:00:00Z'); // 4 hours later (< 12h)

      const shouldNotify = service.shouldNotify(
        RiskLevel.MILD_STRESS,
        RiskLevel.HIGH_RISK,
        t1,
        t0,
      );

      expect(shouldNotify).toBe(false);
    });

    it('should allow notification once 12h cooldown window has elapsed', () => {
      const t0 = new Date('2026-11-06T00:00:00Z');
      const t1 = new Date('2026-11-06T13:00:00Z'); // 13 hours later (>= 12h)

      const shouldNotify = service.shouldNotify(
        RiskLevel.MILD_STRESS,
        RiskLevel.HIGH_RISK,
        t1,
        t0,
      );

      expect(shouldNotify).toBe(true);
    });

    it('should NOT notify on downward transitions', () => {
      const shouldNotify = service.shouldNotify(
        RiskLevel.HIGH_RISK,
        RiskLevel.MODERATE_RISK,
        new Date('2026-11-06T10:00:00Z'),
        undefined,
      );

      expect(shouldNotify).toBe(false);
    });
  });

  describe('Comprehensive Transition Matrix Coverage across all levels', () => {
    it('should return currentLevel when candidate level equals currentLevel', () => {
      expect(service.computeNextLevel(RiskLevel.NORMAL, 0.1, 0, 0.1)).toBe(
        RiskLevel.NORMAL,
      );
      expect(
        service.computeNextLevel(RiskLevel.MILD_STRESS, 0.35, 0, 0.35),
      ).toBe(RiskLevel.MILD_STRESS);
      expect(
        service.computeNextLevel(RiskLevel.MODERATE_RISK, 0.55, 0, 0.55),
      ).toBe(RiskLevel.MODERATE_RISK);
      expect(service.computeNextLevel(RiskLevel.CRISIS, 0.95, 0, 0.95)).toBe(
        RiskLevel.CRISIS,
      );
    });

    it('should cover all upward step transitions with 2 stable windows', () => {
      // NORMAL -> MILD_STRESS (enter 0.3)
      expect(service.computeNextLevel(RiskLevel.NORMAL, 0.35, 1, 0.35)).toBe(
        RiskLevel.MILD_STRESS,
      );

      // MILD_STRESS -> MODERATE_RISK (enter 0.5)
      expect(
        service.computeNextLevel(RiskLevel.MILD_STRESS, 0.55, 1, 0.55),
      ).toBe(RiskLevel.MODERATE_RISK);

      // MODERATE_RISK -> HIGH_RISK (enter 0.7)
      expect(
        service.computeNextLevel(RiskLevel.MODERATE_RISK, 0.75, 1, 0.75),
      ).toBe(RiskLevel.HIGH_RISK);

      // HIGH_RISK -> CRISIS (enter 0.85)
      expect(service.computeNextLevel(RiskLevel.HIGH_RISK, 0.9, 1, 0.9)).toBe(
        RiskLevel.CRISIS,
      );
    });

    it('should cover all downward step transitions with 2 stable windows', () => {
      // CRISIS -> HIGH_RISK (exit 0.75)
      expect(service.computeNextLevel(RiskLevel.CRISIS, 0.72, 1, 0.72)).toBe(
        RiskLevel.HIGH_RISK,
      );

      // HIGH_RISK -> MODERATE_RISK (exit 0.60)
      expect(service.computeNextLevel(RiskLevel.HIGH_RISK, 0.55, 1, 0.55)).toBe(
        RiskLevel.MODERATE_RISK,
      );

      // MODERATE_RISK -> MILD_STRESS (exit 0.40)
      expect(
        service.computeNextLevel(RiskLevel.MODERATE_RISK, 0.35, 1, 0.35),
      ).toBe(RiskLevel.MILD_STRESS);

      // MILD_STRESS -> NORMAL (exit 0.20)
      expect(
        service.computeNextLevel(RiskLevel.MILD_STRESS, 0.15, 1, 0.15),
      ).toBe(RiskLevel.NORMAL);
    });

    it('should safely handle unknown risk levels and non-finite numbers', () => {
      expect(service.computeNextLevel('UNKNOWN' as any, NaN, NaN, NaN)).toBe(
        'UNKNOWN',
      );
      expect(
        (service as any).maxLevel(RiskLevel.NORMAL, RiskLevel.HIGH_RISK),
      ).toBe(RiskLevel.HIGH_RISK);
    });
  });
});
