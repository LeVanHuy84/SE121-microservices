import { ScoreCombinerService } from "./score-combiner.service";

describe("ScoreCombinerService", () => {
  let service: ScoreCombinerService;

  beforeEach(() => {
    service = new ScoreCombinerService();
  });

  describe("normalizeBaseScore", () => {
    it("should return 0 when score is below or equal to SCORE_MIN (0.5)", () => {
      expect(service.normalizeBaseScore(0)).toBe(0);
      expect(service.normalizeBaseScore(0.3)).toBe(0);
      expect(service.normalizeBaseScore(0.5)).toBe(0);
    });

    it("should return 1 when score reaches or exceeds SCORE_MAX (15.0)", () => {
      expect(service.normalizeBaseScore(15.0)).toBeCloseTo(1.0, 5);
      expect(service.normalizeBaseScore(20.0)).toBe(1.0);
    });

    it("should return smooth logarithmic scaling between 0 and 1 for intermediate scores", () => {
      const score5 = service.normalizeBaseScore(5.0);
      const score10 = service.normalizeBaseScore(10.0);

      expect(score5).toBeGreaterThan(0.5);
      expect(score5).toBeLessThan(score10);
      expect(score10).toBeLessThan(1.0);
    });
  });

  describe("combine", () => {
    it("should correctly combine scores for a normal user without distress", () => {
      const result = service.combine({
        base: 5.0,
        emotion: 0.8,
        affinity: 0.7,
        riskScore: 0,
        recentNegativityScore: 0,
      });

      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(1);

      // Verify that base score has meaningful impact (no Sigmoid 200 collapse)
      const higherBaseResult = service.combine({
        base: 12.0,
        emotion: 0.8,
        affinity: 0.7,
        riskScore: 0,
        recentNegativityScore: 0,
      });
      expect(higherBaseResult).toBeGreaterThan(result);
    });

    it("should adapt weights when user is under distress (high riskScore and negativity)", () => {
      const normalResult = service.combine({
        base: 10.0,
        emotion: 0.9,
        affinity: 0.5,
        riskScore: 0,
        recentNegativityScore: 0,
      });

      const distressedResult = service.combine({
        base: 10.0,
        emotion: 0.9,
        affinity: 0.5,
        riskScore: 0.9,
        recentNegativityScore: 0.8,
      });

      // Under distress, emotion weight increases (0.25 -> 0.60), boosting posts with high emotion alignment
      expect(distressedResult).toBeGreaterThan(normalResult);
    });
  });
});
