import { Test, TestingModule } from '@nestjs/testing';
import { CandidateRetrievalService } from './candidate-retrieval.service';
import { RecommendationStateRepository } from './recommendation-state.repository';

describe('CandidateRetrievalService', () => {
  let service: CandidateRetrievalService;
  let repository: {
    searchSemanticCandidates: jest.Mock;
    getGraphExcludedCandidateIds: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      searchSemanticCandidates: jest.fn().mockResolvedValue([]),
      getGraphExcludedCandidateIds: jest.fn().mockResolvedValue(new Set()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateRetrievalService,
        { provide: RecommendationStateRepository, useValue: repository },
      ],
    }).compile();

    service = module.get<CandidateRetrievalService>(CandidateRetrievalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSemanticOnlineBatch', () => {
    it('should query semantic candidates, map to batch and determine hasNext', async () => {
      repository.searchSemanticCandidates.mockResolvedValueOnce([
        {
          candidateId: 'c1',
          candidateProfileText: 'text 1',
          retrievalScore: 0.9,
        },
        {
          candidateId: 'c2',
          candidateProfileText: 'text 2',
          retrievalScore: 0.8,
        },
        {
          candidateId: 'c3',
          candidateProfileText: 'text 3',
          retrievalScore: 0.7,
        },
      ]);

      const batch = await service.getSemanticOnlineBatch('v1', 0, 2);

      expect(batch.source).toBe('semantic_online');
      expect(batch.candidates).toHaveLength(2);
      expect(batch.candidates[0].candidateId).toBe('c1');
      expect(batch.hasNext).toBe(true);
    });

    it('should handle offset correctly', async () => {
      repository.searchSemanticCandidates.mockResolvedValueOnce([
        { candidateId: 'c1', retrievalScore: 0.9 },
        { candidateId: 'c2', retrievalScore: 0.8 },
        { candidateId: 'c3', retrievalScore: 0.7 },
      ]);

      const batch = await service.getSemanticOnlineBatch('v1', 1, 2);

      expect(batch.candidates).toHaveLength(2);
      expect(batch.candidates[0].candidateId).toBe('c2');
      expect(batch.candidates[1].candidateId).toBe('c3');
      expect(batch.hasNext).toBe(false);
    });
  });

  describe('filterGraphProjection', () => {
    it('should filter out graph-excluded candidates', async () => {
      repository.getGraphExcludedCandidateIds.mockResolvedValueOnce(
        new Set(['c2']),
      );

      const candidates = [
        { candidateId: 'c1' },
        { candidateId: 'c2' },
        { candidateId: 'c3' },
      ];
      const filtered = await service.filterGraphProjection('v1', candidates);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((c) => c.candidateId)).toEqual(['c1', 'c3']);
    });

    it('should return empty array if candidates array is empty', async () => {
      const filtered = await service.filterGraphProjection('v1', []);
      expect(filtered).toEqual([]);
      expect(repository.getGraphExcludedCandidateIds).not.toHaveBeenCalled();
    });
  });
});
