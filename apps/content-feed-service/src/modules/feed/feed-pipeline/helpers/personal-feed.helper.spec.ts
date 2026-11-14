import { PersonalFeedHelper } from "./personal-feed.helper";

describe("PersonalFeedHelper", () => {
  describe("Session Snapshot Cursor Encoding", () => {
    it("should encode and decode session cursor correctly", () => {
      const sessionId = "test-session-123";
      const offset = 20;

      const cursor = PersonalFeedHelper.encodeSessionCursor(sessionId, offset);
      expect(typeof cursor).toBe("string");

      const decoded = PersonalFeedHelper.decodeSessionCursor(cursor);
      expect(decoded).not.toBeNull();
      expect(decoded?.sessionId).toBe(sessionId);
      expect(decoded?.offset).toBe(offset);
    });

    it("should return null when decoding invalid cursor", () => {
      expect(
        PersonalFeedHelper.decodeSessionCursor("invalid-base64"),
      ).toBeNull();
      expect(PersonalFeedHelper.decodeSessionCursor(undefined)).toBeNull();
      expect(PersonalFeedHelper.decodeSessionCursor("")).toBeNull();
    });
  });

  describe("5-parameter EMA Distress Formulation", () => {
    it("should return 0 when features is null or empty", () => {
      expect(PersonalFeedHelper.calcDistress(null)).toBe(0);
      expect(PersonalFeedHelper.calcDistress(undefined)).toBe(0);
      expect(PersonalFeedHelper.calcDistress({})).toBe(0);
    });

    it("should accurately compute distress from 5 EMA parameters", () => {
      // 0.3 * 0.8 + 0.35 * 0.7 + 0.15 * 0.6 + 0.2 * 0.5 - 0.1 * 0.2
      // = 0.24 + 0.245 + 0.09 + 0.1 - 0.02 = 0.655
      const distress = PersonalFeedHelper.calcDistress({
        riskScore: 0.8,
        recentNegativityScore: 0.7,
        negativeRatio7d: 0.6,
        emotionVolatility7d: 0.5,
        emotionMomentum: 0.2,
      });

      expect(distress).toBeCloseTo(0.655, 3);
    });

    it("should clamp distress within [0, 1]", () => {
      const highDistress = PersonalFeedHelper.calcDistress({
        riskScore: 1.5,
        recentNegativityScore: 1.5,
        negativeRatio7d: 1.0,
        emotionVolatility7d: 1.0,
        emotionMomentum: -0.5,
      });
      expect(highDistress).toBe(1.0);

      const negativeDistress = PersonalFeedHelper.calcDistress({
        riskScore: 0,
        recentNegativityScore: 0,
        emotionMomentum: 1.0,
      });
      expect(negativeDistress).toBe(0);
    });
  });

  describe("Dynamic Adaptive Multi-Objective Ranking", () => {
    it("should favor recency and social affinity when user is in normal state (distress = 0)", () => {
      const score = PersonalFeedHelper.calcAdaptiveScore({
        recency: 0.9,
        affinity: 0.8,
        emotion: 0.5,
        engagement: 0.4,
        distress: 0,
      });

      // At d = 0: wRec=0.4, wAff=0.2, wEmo=0.35, wEng=0.05
      // Expected = 0.4*0.9 + 0.2*0.8 + 0.35*0.5 + 0.05*0.4 - 0.3*0 = 0.36 + 0.16 + 0.175 + 0.02 = 0.715
      expect(score).toBeCloseTo(0.715, 3);
    });

    it("should heavily shift weight to emotion and penalize toxicity when user is under distress (distress > 0.6)", () => {
      const scoreWithoutToxicity = PersonalFeedHelper.calcAdaptiveScore({
        recency: 0.5,
        affinity: 0.5,
        emotion: 0.9,
        engagement: 0.5,
        distress: 0.8,
        toxicity: 0,
      });

      const scoreWithToxicity = PersonalFeedHelper.calcAdaptiveScore({
        recency: 0.5,
        affinity: 0.5,
        emotion: 0.9,
        engagement: 0.5,
        distress: 0.8,
        toxicity: 0.5,
      });

      // At d = 0.8, lambda = 0.3 + 0.7*0.8 = 0.86
      // Penalty should significantly reduce final score
      expect(scoreWithToxicity).toBeLessThan(scoreWithoutToxicity);
      expect(scoreWithoutToxicity - scoreWithToxicity).toBeCloseTo(
        0.86 * 0.5,
        2,
      );
    });
  });
});
