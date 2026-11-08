import { Test, TestingModule } from '@nestjs/testing';
import { RankingService } from './ranking.service';
import { RecommendationStateRepository } from './recommendation-state.repository';
import { EmbeddingService } from './embedding.service';

describe('RankingService', () => {
  let service: RankingService;
  let repository: {
    getGraphPairFeatures: jest.Mock;
    getEmotionProfiles: jest.Mock;
  };
  let embeddingService: {
    isReady: jest.Mock;
    formatQueryText: jest.Mock;
    formatCandidateText: jest.Mock;
    generateEmbedding: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      getGraphPairFeatures: jest.fn().mockResolvedValue({}),
      getEmotionProfiles: jest.fn().mockResolvedValue({}),
    };

    embeddingService = {
      isReady: jest.fn().mockReturnValue(true),
      formatQueryText: jest.fn().mockImplementation((t) => `query: ${t}`),
      formatCandidateText: jest.fn().mockImplementation((t) => `passage: ${t}`),
      generateEmbedding: jest.fn().mockResolvedValue([1.0, 0.0]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingService,
        { provide: RecommendationStateRepository, useValue: repository },
        { provide: EmbeddingService, useValue: embeddingService },
      ],
    }).compile();

    service = module.get<RankingService>(RankingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('dedupeCandidates', () => {
    it('should remove duplicates and empty candidateIds', async () => {
      const candidates = [
        { candidateId: 'c1', retrievalScore: 0.8 },
        { candidateId: 'c1', retrievalScore: 0.5 },
        { candidateId: '', retrievalScore: 0.9 },
        { candidateId: 'c2', retrievalScore: 0.7 },
      ];

      const ranked = await service.rankCandidates('v1', null, candidates);
      expect(ranked).toHaveLength(2);
      expect(ranked.map((c) => c.candidateId)).toEqual(['c1', 'c2']);
    });
  });

  describe('TC-REC-05: Multi-Factor Final Scoring', () => {
    it('should compute finalScore using weighted formula (Model 0.56, Retrieval 0.24, Graph 0.12, Emotion 0.08)', async () => {
      // Setup pair feature with 5 mutual friends (cap=10 -> mutualFriendScore=0.5 -> graphScore=0.7*0.5=0.35)
      repository.getGraphPairFeatures.mockResolvedValueOnce({
        c1: { mutualFriendCount: 5, lastEventType: null },
      });

      // Setup emotion profile
      const now = new Date();
      repository.getEmotionProfiles.mockResolvedValueOnce({
        v1: {
          recentNegativityScore: 0.2,
          riskScore: 0.1,
          updatedAt: now,
        },
        c1: {
          recentNegativityScore: 0.2,
          riskScore: 0.1,
          updatedAt: now,
        },
      });

      // Provide precomputed embeddings for dot-product
      // queryVector: [1, 0], candidateVector: [1, 0] -> similarity = 1.0
      // calibrated = (1.0 - 0.55)/(0.9 - 0.55) = 0.45 / 0.35 = 1.2857 -> clamped to 1.0
      const candidates = [
        {
          candidateId: 'c1',
          candidateProfileText: 'profile text',
          retrievalScore: 0.8,
          embedding: [1.0, 0.0],
        },
      ];

      const result = await service.rankCandidates(
        'v1',
        'viewer profile',
        candidates,
        [1.0, 0.0],
      );

      expect(result).toHaveLength(1);
      const top = result[0];
      expect(top.rank).toBe(1);
      expect(top.modelScore).toBeCloseTo(1.0, 2);
      expect(top.retrievalScore).toBe(0.8);
      // graphScore: 0.7 * (5/10) = 0.35
      // emotionScore > 0
      // finalScore: 0.56 * 1.0 + 0.24 * 0.8 + 0.12 * 0.35 + 0.08 * emotionScore
      expect(top.finalScore).toBeGreaterThan(0.7);
    });
  });

  describe('TC-REC-06: Emotion Affinity Calculation', () => {
    it('should calculate emotion affinity and apply risk penalty when average risk > 0.7', async () => {
      const now = new Date();
      repository.getEmotionProfiles.mockResolvedValueOnce({
        v1: {
          recentNegativityScore: 0.5,
          riskScore: 0.8,
          updatedAt: now,
        },
        c1: {
          recentNegativityScore: 0.5,
          riskScore: 0.8,
          updatedAt: now,
        },
      });

      const candidates = [{ candidateId: 'c1', retrievalScore: 0.5 }];
      const result = await service.rankCandidates('v1', null, candidates);

      expect(result[0].emotionScore).toBeDefined();
      // High risk (0.8 + 0.8)/2 = 0.8 > 0.7 triggers risk penalty
      expect(result[0].emotionScore).toBeLessThan(0.5);
    });
  });

  describe('TC-REC-07: Stale Emotion Profile', () => {
    it('should return emotionScore = 0.0 when emotion profile is older than 168 hours', async () => {
      const staleDate = new Date(Date.now() - 200 * 3600 * 1000); // 200 hours ago
      repository.getEmotionProfiles.mockResolvedValueOnce({
        v1: {
          recentNegativityScore: 0.1,
          riskScore: 0.1,
          updatedAt: staleDate,
        },
        c1: {
          recentNegativityScore: 0.1,
          riskScore: 0.1,
          updatedAt: new Date(),
        },
      });

      const candidates = [{ candidateId: 'c1', retrievalScore: 0.5 }];
      const result = await service.rankCandidates('v1', null, candidates);

      expect(result[0].emotionScore).toBe(0.0);
    });
  });

  describe('Reason codes building', () => {
    it('should generate mutual friend and high semantic similarity reason codes', async () => {
      repository.getGraphPairFeatures.mockResolvedValueOnce({
        c1: { mutualFriendCount: 4, lastEventType: null },
      });

      const candidates = [
        {
          candidateId: 'c1',
          candidateProfileText: 'text',
          retrievalScore: 0.5,
          embedding: [1.0, 0.0],
        },
      ];

      const result = await service.rankCandidates(
        'v1',
        'profile',
        candidates,
        [1.0, 0.0],
      );
      expect(result[0].reasonCodes).toContain('semantic_rerank');
      expect(result[0].reasonCodes).toContain('graph_mutual_friend');
    });
  });
});
