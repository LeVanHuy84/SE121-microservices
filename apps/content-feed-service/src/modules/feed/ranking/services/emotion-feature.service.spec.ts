import { EmotionFeatureService } from "./emotion-feature.service";
import { EmotionRankingFeaturesDto } from "@repo/dtos";

describe("EmotionFeatureService - Iso-Principle & Safety", () => {
  let service: EmotionFeatureService;
  let mockRedis: any;
  let mockClient: any;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
    };
    mockClient = {
      send: jest.fn(),
    };
    service = new EmotionFeatureService(mockRedis, mockClient);
  });

  describe("calcIsoPrincipleScore", () => {
    it("should prioritize joy, neutral, and novelty when user is normal (distress <= 0.3)", () => {
      const normalFeatures: EmotionRankingFeaturesDto = {
        userEmotionPreference: { joy: 0.5, neutral: 0.5 },
        last24hEmotionDistribution: { joy: 0.2, neutral: 0.2 },
        negativeRatio7d: 0.1,
        emotionVolatility7d: 0.1,
        riskScore: 0.1,
        recentNegativityScore: 0.1,
        emotionMomentum: 0.2,
      };

      const positivePost = { joy: 0.8, neutral: 0.2 };
      const score = service.calcIsoPrincipleScore(normalFeatures, positivePost);

      expect(score).toBeGreaterThan(0.4);
    });

    it("should prioritize Calming Bridge (neutral) and avoid Toxic Positivity when user is distressed", () => {
      const distressedFeatures: EmotionRankingFeaturesDto = {
        userEmotionPreference: { sadness: 0.8, neutral: 0.1 },
        last24hEmotionDistribution: { sadness: 0.7, neutral: 0.3 },
        negativeRatio7d: 0.7,
        emotionVolatility7d: 0.6,
        riskScore: 0.8,
        recentNegativityScore: 0.9,
        emotionMomentum: -0.3,
      };

      // Calming post with high neutral score (7-class PhoBERT canonical)
      const calmingPost = { neutral: 0.8 };
      const calmingScore = service.calcIsoPrincipleScore(
        distressedFeatures,
        calmingPost,
      );

      // Sad post that amplifies depression (Echo chamber)
      const depressingPost = { sadness: 0.9 };
      const depressingScore = service.calcIsoPrincipleScore(
        distressedFeatures,
        depressingPost,
      );

      expect(calmingScore).toBeGreaterThan(0.4);
      expect(depressingScore).toBeLessThan(0.1);
      expect(calmingScore).toBeGreaterThan(depressingScore);
    });
  });

  describe("calcEmotionScore", () => {
    it("should calculate score incorporating risk penalties", () => {
      const features: EmotionRankingFeaturesDto = {
        userEmotionPreference: { joy: 0.5, neutral: 0.5 },
        last24hEmotionDistribution: { joy: 0.2 },
        negativeRatio7d: 0.1,
        emotionVolatility7d: 0.1,
        riskScore: 0.2,
        recentNegativityScore: 0.2,
        emotionMomentum: 0,
      };

      const post = {
        scores: { joy: 0.7, neutral: 0.3 },
        confidence: 0.9,
      };

      const score = service.calcEmotionScore(features, post);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });
});
