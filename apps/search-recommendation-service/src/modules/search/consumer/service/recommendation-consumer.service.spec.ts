import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationConsumerService } from './recommendation-consumer.service';
import { RecommendationStateRepository } from '../../../recommendation/services/recommendation-state.repository';
import { EmbeddingService } from '../../../recommendation/services/embedding.service';
import { QueryCacheService } from '../../../recommendation/services/query-cache.service';

describe('RecommendationConsumerService', () => {
  let service: RecommendationConsumerService;
  let repository: {
    deleteProfileEmbedding: jest.Mock;
    getProfileEmbedding: jest.Mock;
    upsertProfileEmbedding: jest.Mock;
    recordGraphEvent: jest.Mock;
    applyGraphFriendRequestSent: jest.Mock;
    applyGraphFriendRequestCanceled: jest.Mock;
    applyGraphFriendRequestAccepted: jest.Mock;
    applyGraphFriendRequestDeclined: jest.Mock;
    applyGraphFriendshipRemoved: jest.Mock;
    applyGraphUserBlocked: jest.Mock;
    applyGraphUserUnblocked: jest.Mock;
    applyGraphRecommendationDismissed: jest.Mock;
    refreshGraphPairFeaturesForEvent: jest.Mock;
    upsertEmotionProfile: jest.Mock;
  };
  let embeddingService: {
    formatCandidateText: jest.Mock;
    formatQueryText: jest.Mock;
    generateEmbedding: jest.Mock;
  };
  let cacheService: {
    invalidateViewer: jest.Mock;
    invalidateMany: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      deleteProfileEmbedding: jest.fn().mockResolvedValue(undefined),
      getProfileEmbedding: jest.fn().mockResolvedValue(null),
      upsertProfileEmbedding: jest.fn().mockResolvedValue(undefined),
      recordGraphEvent: jest.fn().mockResolvedValue(undefined),
      applyGraphFriendRequestSent: jest.fn().mockResolvedValue(undefined),
      applyGraphFriendRequestCanceled: jest.fn().mockResolvedValue(undefined),
      applyGraphFriendRequestAccepted: jest.fn().mockResolvedValue(undefined),
      applyGraphFriendRequestDeclined: jest.fn().mockResolvedValue(undefined),
      applyGraphFriendshipRemoved: jest.fn().mockResolvedValue(undefined),
      applyGraphUserBlocked: jest.fn().mockResolvedValue(undefined),
      applyGraphUserUnblocked: jest.fn().mockResolvedValue(undefined),
      applyGraphRecommendationDismissed: jest.fn().mockResolvedValue(undefined),
      refreshGraphPairFeaturesForEvent: jest.fn().mockResolvedValue(undefined),
      upsertEmotionProfile: jest.fn().mockResolvedValue(undefined),
    };

    embeddingService = {
      formatCandidateText: jest.fn().mockImplementation((t) => `passage: ${t}`),
      formatQueryText: jest.fn().mockImplementation((t) => `query: ${t}`),
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };

    cacheService = {
      invalidateViewer: jest.fn().mockResolvedValue(undefined),
      invalidateMany: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationConsumerService,
        { provide: RecommendationStateRepository, useValue: repository },
        { provide: EmbeddingService, useValue: embeddingService },
        { provide: QueryCacheService, useValue: cacheService },
      ],
    }).compile();

    service = module.get<RecommendationConsumerService>(
      RecommendationConsumerService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleProfileEmbeddingRequested', () => {
    it('should skip invalid payload without userId or requestId', async () => {
      await service.handleProfileEmbeddingRequested({});
      expect(repository.upsertProfileEmbedding).not.toHaveBeenCalled();
    });

    it('should delete profile embedding and invalidate cache when semanticProfileText is null', async () => {
      await service.handleProfileEmbeddingRequested({
        userId: 'user-1',
        requestId: 'req-1',
        semanticProfileText: null,
      });

      expect(repository.deleteProfileEmbedding).toHaveBeenCalledWith('user-1');
      expect(cacheService.invalidateViewer).toHaveBeenCalledWith('user-1');
      expect(repository.upsertProfileEmbedding).not.toHaveBeenCalled();
    });

    it('should skip embedding generation if profile text is unchanged', async () => {
      repository.getProfileEmbedding.mockResolvedValueOnce({
        semanticProfileText: 'same profile',
        dimensions: 3,
      });

      await service.handleProfileEmbeddingRequested({
        userId: 'user-1',
        requestId: 'req-1',
        semanticProfileText: 'same profile',
      });

      expect(embeddingService.generateEmbedding).not.toHaveBeenCalled();
      expect(repository.upsertProfileEmbedding).not.toHaveBeenCalled();
    });

    it('should generate embeddings and upsert when text is new or updated', async () => {
      await service.handleProfileEmbeddingRequested({
        userId: 'user-1',
        requestId: 'req-1',
        semanticProfileText: 'new bio profile',
      });

      expect(embeddingService.generateEmbedding).toHaveBeenCalledTimes(2);
      expect(repository.upsertProfileEmbedding).toHaveBeenCalledWith(
        'user-1',
        'new bio profile',
        [0.1, 0.2, 0.3],
        [0.1, 0.2, 0.3],
        'Xenova/multilingual-e5-base',
        expect.any(String),
      );
      expect(cacheService.invalidateViewer).toHaveBeenCalledWith('user-1');
    });
  });

  describe('handleGraphEvent', () => {
    it('should skip if userId or targetUserId is missing', async () => {
      await service.handleGraphEvent('some-type', { userId: 'u1' });
      expect(repository.recordGraphEvent).not.toHaveBeenCalled();
    });

    it('should handle all graph event types properly', async () => {
      const typesAndHandlers: [string, keyof typeof repository][] = [
        [
          'recommendation.graph.friend-request-sent',
          'applyGraphFriendRequestSent',
        ],
        [
          'recommendation.graph.friend-request-canceled',
          'applyGraphFriendRequestCanceled',
        ],
        [
          'recommendation.graph.friend-request-accepted',
          'applyGraphFriendRequestAccepted',
        ],
        [
          'recommendation.graph.friend-request-declined',
          'applyGraphFriendRequestDeclined',
        ],
        [
          'recommendation.graph.friendship-removed',
          'applyGraphFriendshipRemoved',
        ],
        ['recommendation.graph.user-blocked', 'applyGraphUserBlocked'],
        ['recommendation.graph.user-unblocked', 'applyGraphUserUnblocked'],
        [
          'recommendation.graph.recommendation-dismissed',
          'applyGraphRecommendationDismissed',
        ],
      ];

      for (const [type, handlerKey] of typesAndHandlers) {
        await service.handleGraphEvent(type, {
          userId: 'user-a',
          targetUserId: 'user-b',
        });

        expect(repository[handlerKey]).toHaveBeenCalled();
      }

      expect(repository.refreshGraphPairFeaturesForEvent).toHaveBeenCalled();
      expect(cacheService.invalidateMany).toHaveBeenCalledWith([
        'user-a',
        'user-b',
      ]);
    });
  });

  describe('handleEmotionEvent', () => {
    it('should skip if userId is missing', async () => {
      await service.handleEmotionEvent('some-type', {});
      expect(repository.upsertEmotionProfile).not.toHaveBeenCalled();
    });

    it('should upsert emotion profile and invalidate cache', async () => {
      await service.handleEmotionEvent('emotion-type', {
        userId: 'user-1',
        riskScore: 0.65,
        recentNegativityScore: 0.4,
        dominantEmotion: 'sadness',
        finalScores: { sadness: 0.8 },
      });

      expect(repository.upsertEmotionProfile).toHaveBeenCalledWith(
        'user-1',
        0.65,
        0.4,
        'sadness',
        { sadness: 0.8 },
        expect.any(Date),
      );
      expect(cacheService.invalidateViewer).toHaveBeenCalledWith('user-1');
    });
  });
});
