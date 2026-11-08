import { Test, TestingModule } from '@nestjs/testing';
import { QueryService } from './query.service';
import { RecommendationStateRepository } from './recommendation-state.repository';
import { CandidateRetrievalService } from './candidate-retrieval.service';
import { GlobalFallbackService } from './global-fallback.service';
import { RankingService } from './ranking.service';
import { QueryCacheService } from './query-cache.service';

describe('QueryService', () => {
  let service: QueryService;
  let repository: {
    getProfileEmbedding: jest.Mock;
  };
  let retrievalService: {
    getSemanticOnlineBatch: jest.Mock;
  };
  let fallbackService: {
    getBatch: jest.Mock;
  };
  let rankingService: {
    rankCandidates: jest.Mock;
  };
  let cacheService: {
    get: jest.Mock;
    set: jest.Mock;
    storeCandidateSession: jest.Mock;
    getCandidateSession: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      getProfileEmbedding: jest.fn().mockResolvedValue({
        semanticProfileText: 'viewer profile text',
        queryEmbedding: [1.0, 0.0],
      }),
    };

    retrievalService = {
      getSemanticOnlineBatch: jest.fn(),
    };

    fallbackService = {
      getBatch: jest.fn().mockResolvedValue([[], false]),
    };

    rankingService = {
      rankCandidates: jest.fn().mockImplementation((viewerId, text, cands) =>
        Promise.resolve(
          cands.map((c: any, i: number) => ({
            ...c,
            finalScore: 0.9 - i * 0.1,
            rank: i + 1,
          })),
        ),
      ),
    };

    cacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockImplementation((req, out) => Promise.resolve(out)),
      storeCandidateSession: jest.fn().mockResolvedValue('session-uuid-123'),
      getCandidateSession: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryService,
        { provide: RecommendationStateRepository, useValue: repository },
        { provide: CandidateRetrievalService, useValue: retrievalService },
        { provide: GlobalFallbackService, useValue: fallbackService },
        { provide: RankingService, useValue: rankingService },
        { provide: QueryCacheService, useValue: cacheService },
      ],
    }).compile();

    service = module.get<QueryService>(QueryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return empty response if viewerId is blank', async () => {
    const res = await service.query({ viewerId: '' });
    expect(res.candidates).toEqual([]);
    expect(res.source).toBe('empty');
  });

  describe('TC-REC-02: Query Cache Hit', () => {
    it('should return cached response immediately without calling db or retrieval', async () => {
      const cached = {
        viewerId: 'v1',
        source: 'semantic_online',
        candidates: [{ candidateId: 'c1', rank: 1 }],
      };
      cacheService.get.mockResolvedValueOnce(cached);

      const res = await service.query({ viewerId: 'v1' });

      expect(res).toBe(cached);
      expect(retrievalService.getSemanticOnlineBatch).not.toHaveBeenCalled();
      expect(rankingService.rankCandidates).not.toHaveBeenCalled();
    });
  });

  describe('TC-REC-01: Online Semantic Recommendation Flow', () => {
    it('should retrieve online batch, rank candidates, cache and return output', async () => {
      retrievalService.getSemanticOnlineBatch.mockResolvedValueOnce({
        source: 'semantic_online',
        candidates: [
          { candidateId: 'c1', retrievalScore: 0.8 },
          { candidateId: 'c2', retrievalScore: 0.7 },
        ],
        hasNext: false,
      });

      const res = await service.query({ viewerId: 'v1', limit: 10 });

      expect(retrievalService.getSemanticOnlineBatch).toHaveBeenCalled();
      expect(rankingService.rankCandidates).toHaveBeenCalled();
      expect(cacheService.set).toHaveBeenCalled();
      expect(res.candidates).toHaveLength(2);
      expect(res.source).toBe('semantic_online');
    });
  });

  describe('TC-REC-03: Session Cursor Pagination', () => {
    it('should paginate using candidate session from Redis', async () => {
      const sessionData = {
        viewerId: 'v1',
        source: 'semantic_online',
        scoreVersion: 'v2',
        candidates: [
          { candidateId: 'c1', rank: 1 },
          { candidateId: 'c2', rank: 2 },
          { candidateId: 'c3', rank: 3 },
          { candidateId: 'c4', rank: 4 },
        ],
      };
      cacheService.getCandidateSession.mockResolvedValueOnce(sessionData);

      // Encode session cursor: source='semantic_session', sessionId='sess-1', offset=2
      const cursor = Buffer.from(
        JSON.stringify({
          source: 'semantic_session',
          sessionId: 'sess-1',
          offset: 2,
        }),
      ).toString('base64');

      const res = await service.query({ viewerId: 'v1', cursor, limit: 2 });

      expect(cacheService.getCandidateSession).toHaveBeenCalledWith('sess-1');
      expect(res.candidates).toHaveLength(2);
      expect(res.candidates[0].candidateId).toBe('c3');
      expect(res.candidates[1].candidateId).toBe('c4');
      expect(res.source).toBe('semantic_online');
      expect(res.nextCursor).toBeNull();
      expect(res.hasNextPage).toBe(false);
    });
  });

  describe('TC-REC-04: Global Fallback Supplementation', () => {
    it('should supplement candidates from GlobalFallbackService when online batch is short', async () => {
      retrievalService.getSemanticOnlineBatch.mockResolvedValueOnce({
        source: 'semantic_online',
        candidates: [{ candidateId: 'online-1', retrievalScore: 0.9 }],
        hasNext: false,
      });

      fallbackService.getBatch.mockResolvedValueOnce([
        [
          {
            candidateId: 'fallback-1',
            retrievalScore: 0.5,
            source: 'global_fallback',
          },
        ],
        false,
      ]);

      const res = await service.query({ viewerId: 'v1', limit: 5 });

      expect(fallbackService.getBatch).toHaveBeenCalled();
      expect(res.candidates.length).toBeGreaterThanOrEqual(1);
    });

    it('should fallback completely when online batch returns null or throws', async () => {
      retrievalService.getSemanticOnlineBatch.mockRejectedValueOnce(
        new Error('Postgres vector query timeout'),
      );

      fallbackService.getBatch.mockResolvedValueOnce([
        [
          {
            candidateId: 'fallback-only-1',
            retrievalScore: 0.5,
            source: 'global_fallback',
          },
        ],
        false,
      ]);

      const res = await service.query({ viewerId: 'v1', limit: 10 });

      expect(fallbackService.getBatch).toHaveBeenCalled();
      expect(res.candidates[0].candidateId).toBe('fallback-only-1');
      expect(res.source).toBe('global_fallback');
    });
  });
});
