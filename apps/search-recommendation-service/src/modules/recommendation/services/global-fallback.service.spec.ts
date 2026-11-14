import { Test, TestingModule } from '@nestjs/testing';
import { GlobalFallbackService } from './global-fallback.service';
import { RecommendationStateRepository } from './recommendation-state.repository';

describe('GlobalFallbackService', () => {
  let service: GlobalFallbackService;
  let repository: {
    listGlobalFallbackCandidates: jest.Mock;
    getGraphExcludedCandidateIds: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      listGlobalFallbackCandidates: jest.fn(),
      getGraphExcludedCandidateIds: jest.fn().mockResolvedValue(new Set()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GlobalFallbackService,
        {
          provide: RecommendationStateRepository,
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<GlobalFallbackService>(GlobalFallbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getBatch', () => {
    it('should retrieve fallback candidates and exclude viewerId and graph-excluded candidates', async () => {
      repository.listGlobalFallbackCandidates.mockResolvedValueOnce([
        { candidateId: 'viewer-1', fallbackScore: 0.9 },
        { candidateId: 'user-blocked', fallbackScore: 0.8 },
        { candidateId: 'valid-user-1', fallbackScore: 0.7 },
        { candidateId: 'valid-user-2', fallbackScore: 0.6 },
      ]);

      repository.getGraphExcludedCandidateIds.mockResolvedValueOnce(
        new Set(['user-blocked']),
      );

      const [candidates, hasNext] = await service.getBatch('viewer-1', 0, 10);

      expect(candidates).toHaveLength(2);
      expect(candidates[0].candidateId).toBe('valid-user-1');
      expect(candidates[0].source).toBe('global_fallback');
      expect(candidates[1].candidateId).toBe('valid-user-2');
      expect(hasNext).toBe(false);
    });

    it('should set hasNext = true when filtered count exceeds requested size', async () => {
      repository.listGlobalFallbackCandidates.mockResolvedValueOnce([
        { candidateId: 'c1', fallbackScore: 0.9 },
        { candidateId: 'c2', fallbackScore: 0.8 },
        { candidateId: 'c3', fallbackScore: 0.7 },
      ]);

      const [candidates, hasNext] = await service.getBatch('viewer-1', 0, 2);

      expect(candidates).toHaveLength(2);
      expect(hasNext).toBe(true);
    });

    it('should return empty list when repository returns no candidates', async () => {
      repository.listGlobalFallbackCandidates.mockResolvedValueOnce([]);

      const [candidates, hasNext] = await service.getBatch('viewer-1', 0, 10);

      expect(candidates).toEqual([]);
      expect(hasNext).toBe(false);
    });
  });
});
