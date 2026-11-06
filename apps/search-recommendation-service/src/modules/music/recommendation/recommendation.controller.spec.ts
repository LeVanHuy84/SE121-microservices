import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './services/recommendation.service';
import { RiskLevel } from '@repo/dtos';

describe('RecommendationController (Music)', () => {
  let controller: RecommendationController;
  let recommendationService: {
    getRecommendations: jest.Mock;
    getRecommendationsBySignal: jest.Mock;
  };

  beforeEach(async () => {
    recommendationService = {
      getRecommendations: jest.fn().mockResolvedValue({ data: [], total: 0 }),
      getRecommendationsBySignal: jest
        .fn()
        .mockResolvedValue({ data: [], total: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RecommendationController],
      providers: [
        { provide: RecommendationService, useValue: recommendationService },
      ],
    }).compile();

    controller = module.get<RecommendationController>(RecommendationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getRecommendations', async () => {
    const payload = { userId: 'u1', query: { page: 1, limit: 10 } };
    const res = await controller.getRecommendations(payload);

    expect(recommendationService.getRecommendations).toHaveBeenCalledWith(
      'u1',
      payload.query,
    );
    expect(res).toEqual({ data: [], total: 0 });
  });

  it('should delegate getRecommendationsBySignal', async () => {
    const payload = {
      emotionVector: { joy: 0.8 },
      riskLevel: RiskLevel.NORMAL,
      query: { page: 1, limit: 10 },
    };
    const res = await controller.getRecommendationsBySignal(payload);

    expect(
      recommendationService.getRecommendationsBySignal,
    ).toHaveBeenCalledWith(
      { emotionVector: { joy: 0.8 }, riskLevel: RiskLevel.NORMAL },
      payload.query,
    );
    expect(res).toEqual({ data: [], total: 0 });
  });
});
