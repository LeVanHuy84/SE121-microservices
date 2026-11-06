import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationService } from './recommendation.service';
import { CatalogService } from '../../catalog/catalog.service';
import { EmotionSignalService } from '../../discovery/emotion-signal.service';
import { EmotionMappingService } from './emotion-mapping.service';
import { EmotionState, EmotionStateService } from './emotion-state.service';
import { RiskLevel } from '@repo/dtos';

describe('RecommendationService (Music)', () => {
  let service: RecommendationService;
  let emotionSignalService: {
    getUserEmotionSignal: jest.Mock;
  };
  let catalogService: {
    queryForRecommendation: jest.Mock;
  };
  let emotionMappingService: EmotionMappingService;
  let emotionStateService: EmotionStateService;

  beforeEach(async () => {
    emotionSignalService = {
      getUserEmotionSignal: jest.fn(),
    };

    catalogService = {
      queryForRecommendation: jest.fn().mockResolvedValue([
        [
          {
            id: 'm1',
            title: 'Soothing Melodies',
            artist: 'Peaceful Beats',
            valence: 0.6,
            arousal: 0.3,
          },
        ],
        1,
      ]),
    };

    emotionMappingService = new EmotionMappingService();
    emotionStateService = new EmotionStateService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationService,
        { provide: EmotionSignalService, useValue: emotionSignalService },
        { provide: CatalogService, useValue: catalogService },
        { provide: EmotionMappingService, useValue: emotionMappingService },
        { provide: EmotionStateService, useValue: emotionStateService },
      ],
    }).compile();

    service = module.get<RecommendationService>(RecommendationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRecommendations', () => {
    it('should generate recommendations for user based on their emotion signal', async () => {
      emotionSignalService.getUserEmotionSignal.mockResolvedValueOnce({
        userId: 'user-1',
        riskLevel: RiskLevel.NORMAL,
        dominantEmotion: 'sadness',
        valence: 0.2,
        arousal: 0.2,
        emotionScores: { sadness: 0.9 },
      });

      const result = await service.getRecommendations('user-1', {
        page: 1,
        limit: 10,
      });

      expect(emotionSignalService.getUserEmotionSignal).toHaveBeenCalledWith(
        'user-1',
      );
      expect(catalogService.queryForRecommendation).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 0,
          sortByDistanceTo: expect.any(Object),
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.data[0].id).toBe('m1');
    });

    it('should fallback to neutral state when user emotion signal is null', async () => {
      emotionSignalService.getUserEmotionSignal.mockResolvedValueOnce(null);

      const result = await service.getRecommendations('user-1', {
        page: 1,
        limit: 5,
      });

      expect(catalogService.queryForRecommendation).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getRecommendationsBySignal', () => {
    it('should compute target and query catalog when emotion signal is directly passed', async () => {
      const signal = {
        emotionVector: { joy: 0.9 },
        riskLevel: RiskLevel.NORMAL,
      };

      const result = await service.getRecommendationsBySignal(signal, {
        page: 1,
        limit: 10,
      });

      expect(catalogService.queryForRecommendation).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 0,
        }),
      );
      expect(result.data[0].id).toBe('m1');
    });
  });
});
