import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationController } from './recommendation.controller';
import { QueryService } from './services/query.service';
import { QueryCacheService } from './services/query-cache.service';

describe('RecommendationController', () => {
  let controller: RecommendationController;
  let queryService: { query: jest.Mock };
  let cacheService: Partial<QueryCacheService>;

  beforeEach(async () => {
    queryService = { query: jest.fn().mockResolvedValue({ candidates: [] }) };
    cacheService = {};

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationController],
      providers: [
        { provide: QueryService, useValue: queryService },
        { provide: QueryCacheService, useValue: cacheService },
      ],
    }).compile();

    controller = module.get<RecommendationController>(RecommendationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should query candidates successfully', async () => {
    const payload = { viewerId: 'user-1' };
    const res = await controller.queryCandidates(payload);

    expect(queryService.query).toHaveBeenCalledWith(payload);
    expect(res).toEqual({
      success: true,
      data: { candidates: [] },
    });
  });

  it('should return error response if query fails', async () => {
    queryService.query.mockRejectedValueOnce(new Error('DB Failure'));

    const res = await controller.queryCandidates({ viewerId: 'user-1' });

    expect(res).toEqual({
      success: false,
      error: 'DB Failure',
    });
  });

  it('should return cache stats', async () => {
    const res = await controller.getCacheStats();
    expect(res).toEqual({
      success: true,
      data: {
        backend: 'redis',
        available: true,
      },
    });
  });
});
