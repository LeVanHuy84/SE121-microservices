import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationStateRepository } from './recommendation-state.repository';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProfileEmbedding } from '../entities/profile-embedding.entity';
import { RecommendationFriendship } from '../entities/recommendation-friendship.entity';
import { RecommendationPendingRequest } from '../entities/recommendation-pending-request.entity';
import { RecommendationBlock } from '../entities/recommendation-block.entity';
import { RecommendationDismissal } from '../entities/recommendation-dismissal.entity';
import { RecommendationGraphEventJournal } from '../entities/recommendation-graph-event-journal.entity';
import { RecommendationPairFeature } from '../entities/recommendation-pair-feature.entity';
import { RecommendationGlobalFallbackCandidate } from '../entities/recommendation-global-fallback-candidate.entity';
import { RecommendationEmotionProfile } from '../entities/recommendation-emotion-profile.entity';

describe('RecommendationStateRepository', () => {
  let service: RecommendationStateRepository;

  const createMockRepo = () => ({
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest.fn().mockImplementation((dto) => Promise.resolve(dto)),
    findOneBy: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    findBy: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    query: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
    }),
  });

  let profileEmbeddingRepo: ReturnType<typeof createMockRepo>;
  let friendshipRepo: ReturnType<typeof createMockRepo>;
  let pendingRequestRepo: ReturnType<typeof createMockRepo>;
  let blockRepo: ReturnType<typeof createMockRepo>;
  let dismissalRepo: ReturnType<typeof createMockRepo>;
  let graphEventRepo: ReturnType<typeof createMockRepo>;
  let pairFeatureRepo: ReturnType<typeof createMockRepo>;
  let fallbackRepo: ReturnType<typeof createMockRepo>;
  let emotionProfileRepo: ReturnType<typeof createMockRepo>;

  beforeEach(async () => {
    profileEmbeddingRepo = createMockRepo();
    friendshipRepo = createMockRepo();
    pendingRequestRepo = createMockRepo();
    blockRepo = createMockRepo();
    dismissalRepo = createMockRepo();
    graphEventRepo = createMockRepo();
    pairFeatureRepo = createMockRepo();
    fallbackRepo = createMockRepo();
    emotionProfileRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationStateRepository,
        {
          provide: getRepositoryToken(ProfileEmbedding),
          useValue: profileEmbeddingRepo,
        },
        {
          provide: getRepositoryToken(RecommendationFriendship),
          useValue: friendshipRepo,
        },
        {
          provide: getRepositoryToken(RecommendationPendingRequest),
          useValue: pendingRequestRepo,
        },
        {
          provide: getRepositoryToken(RecommendationBlock),
          useValue: blockRepo,
        },
        {
          provide: getRepositoryToken(RecommendationDismissal),
          useValue: dismissalRepo,
        },
        {
          provide: getRepositoryToken(RecommendationGraphEventJournal),
          useValue: graphEventRepo,
        },
        {
          provide: getRepositoryToken(RecommendationPairFeature),
          useValue: pairFeatureRepo,
        },
        {
          provide: getRepositoryToken(RecommendationGlobalFallbackCandidate),
          useValue: fallbackRepo,
        },
        {
          provide: getRepositoryToken(RecommendationEmotionProfile),
          useValue: emotionProfileRepo,
        },
      ],
    }).compile();

    service = module.get<RecommendationStateRepository>(
      RecommendationStateRepository,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should run CREATE EXTENSION IF NOT EXISTS vector query', async () => {
      await service.onModuleInit();
      expect(profileEmbeddingRepo.query).toHaveBeenCalledWith(
        'CREATE EXTENSION IF NOT EXISTS vector;',
      );
    });

    it('should catch error without throwing if extension creation fails', async () => {
      profileEmbeddingRepo.query.mockRejectedValueOnce(
        new Error('permission denied'),
      );
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });

  describe('Profile Embeddings', () => {
    it('upsertProfileEmbedding should save embedding entity and update vector via raw query', async () => {
      await service.upsertProfileEmbedding(
        'user-1',
        'profile text',
        [0.1, 0.2],
        [0.3, 0.4],
        'model-v1',
        new Date().toISOString(),
      );

      expect(profileEmbeddingRepo.save).toHaveBeenCalled();
      expect(profileEmbeddingRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE profile_embeddings'),
        expect.any(Array),
      );
    });

    it('deleteProfileEmbedding should delete by userId', async () => {
      await service.deleteProfileEmbedding('user-1');
      expect(profileEmbeddingRepo.delete).toHaveBeenCalledWith({
        userId: 'user-1',
      });
    });

    it('getProfileEmbedding should retrieve embedding and parse embeddingJson', async () => {
      profileEmbeddingRepo.findOneBy.mockResolvedValueOnce({
        userId: 'user-1',
        semanticProfileText: 'text',
        embeddingJson: [0.1, 0.2],
        queryEmbeddingJson: [0.3, 0.4],
        dimensions: 2,
        modelName: 'model-v1',
        updatedAt: new Date(),
      });

      const profile = await service.getProfileEmbedding('user-1');
      expect(profile).toBeDefined();
      expect(profile?.userId).toBe('user-1');
      expect(profile?.embedding).toEqual([0.1, 0.2]);
      expect(profile?.queryEmbedding).toEqual([0.3, 0.4]);
    });
  });

  describe('Graph Events & State Updates', () => {
    it('recordGraphEvent should save event in graphEventRepo', async () => {
      await service.recordGraphEvent(
        'recommendation.graph.friend-request-sent',
        'u1',
        'u2',
        new Date(),
        'social_service',
        { test: 1 },
      );
      expect(graphEventRepo.save).toHaveBeenCalled();
    });

    it('applyGraphFriendRequestSent should save pending request', async () => {
      await service.applyGraphFriendRequestSent('u1', 'u2');
      expect(pendingRequestRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ requesterId: 'u1', receiverId: 'u2' }),
      );
    });

    it('applyGraphFriendRequestCanceled should delete pending request', async () => {
      await service.applyGraphFriendRequestCanceled('u1', 'u2');
      expect(pendingRequestRepo.delete).toHaveBeenCalledWith({
        requesterId: 'u1',
        receiverId: 'u2',
      });
    });

    it('applyGraphFriendRequestAccepted should save friendships and delete pending requests', async () => {
      await service.applyGraphFriendRequestAccepted('u1', 'u2');
      expect(friendshipRepo.save).toHaveBeenCalled();
      expect(pendingRequestRepo.delete).toHaveBeenCalled();
    });

    it('applyGraphFriendRequestDeclined should delete pending request', async () => {
      await service.applyGraphFriendRequestDeclined('u1', 'u2');
      expect(pendingRequestRepo.delete).toHaveBeenCalledWith({
        requesterId: 'u2',
        receiverId: 'u1',
      });
    });

    it('applyGraphFriendshipRemoved should delete friendship in both directions', async () => {
      await service.applyGraphFriendshipRemoved('u1', 'u2');
      expect(friendshipRepo.delete).toHaveBeenCalledWith({
        userId: 'u1',
        friendId: 'u2',
      });
      expect(friendshipRepo.delete).toHaveBeenCalledWith({
        userId: 'u2',
        friendId: 'u1',
      });
    });

    it('applyGraphUserBlocked should save block and delete friendships and pending requests', async () => {
      await service.applyGraphUserBlocked('u1', 'u2');
      expect(blockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ blockerId: 'u1', blockedId: 'u2' }),
      );
      expect(friendshipRepo.delete).toHaveBeenCalled();
      expect(pendingRequestRepo.delete).toHaveBeenCalled();
    });

    it('applyGraphUserUnblocked should delete block record', async () => {
      await service.applyGraphUserUnblocked('u1', 'u2');
      expect(blockRepo.delete).toHaveBeenCalledWith({
        blockerId: 'u1',
        blockedId: 'u2',
      });
    });

    it('applyGraphRecommendationDismissed should save dismissal with expiry', async () => {
      const expiresAt = new Date();
      await service.applyGraphRecommendationDismissed('u1', 'u2', expiresAt);
      expect(dismissalRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', candidateId: 'u2', expiresAt }),
      );
    });
  });

  describe('Graph Pair Features & Exclusions', () => {
    it('getGraphPairFeatures should retrieve pair features mapped by candidateId', async () => {
      pairFeatureRepo.find.mockResolvedValueOnce([
        { candidateId: 'u2', mutualFriendCount: 3, lastEventType: 'test' },
      ]);
      friendshipRepo.query.mockResolvedValueOnce([
        { candidateId: 'u2', mutualCount: 3 },
      ]);

      const res = await service.getGraphPairFeatures('u1', ['u2']);
      expect(res['u2']).toBeDefined();
      expect(res['u2'].mutualFriendCount).toBe(3);
    });

    it('getGraphExcludedCandidateIds should return set of blocked, friends, pending, and dismissed IDs', async () => {
      friendshipRepo.find.mockResolvedValueOnce([
        { userId: 'u1', friendId: 'friend-1' },
      ]);
      blockRepo.find.mockResolvedValueOnce([
        { blockerId: 'u1', blockedId: 'blocked-1' },
        { blockerId: 'blocker-1', blockedId: 'u1' },
      ]);
      pendingRequestRepo.find.mockResolvedValueOnce([
        { requesterId: 'u1', receiverId: 'req-out-1' },
        { requesterId: 'req-in-1', receiverId: 'u1' },
      ]);
      dismissalRepo.find.mockResolvedValueOnce([
        {
          userId: 'u1',
          candidateId: 'dismissed-1',
          expiresAt: new Date(Date.now() + 100000),
        },
      ]);

      const excluded = await service.getGraphExcludedCandidateIds('u1', [
        'friend-1',
        'blocked-1',
        'blocker-1',
        'req-out-1',
        'req-in-1',
        'dismissed-1',
        'allowed-1',
      ]);

      expect(excluded.has('friend-1')).toBe(true);
      expect(excluded.has('blocked-1')).toBe(true);
      expect(excluded.has('blocker-1')).toBe(true);
      expect(excluded.has('req-out-1')).toBe(true);
      expect(excluded.has('req-in-1')).toBe(true);
      expect(excluded.has('dismissed-1')).toBe(true);
      expect(excluded.has('allowed-1')).toBe(false);
    });

    it('listGlobalFallbackCandidates should return fallback rows', async () => {
      fallbackRepo.find.mockResolvedValueOnce([
        {
          candidateId: 'c1',
          fallbackScore: 0.9,
          rank: 1,
          locale: 'en',
          language: 'en',
          scoreVersion: 'v1',
          generatedAt: new Date(),
        },
      ]);

      const rows = await service.listGlobalFallbackCandidates(0, 10);
      expect(rows).toHaveLength(1);
      expect(rows[0].candidateId).toBe('c1');
    });
  });

  describe('Emotion Profiles', () => {
    it('upsertEmotionProfile should save emotion profile', async () => {
      await service.upsertEmotionProfile(
        'user-1',
        0.5,
        0.3,
        'joy',
        { joy: 0.8 },
        new Date(),
      );

      expect(emotionProfileRepo.save).toHaveBeenCalled();
    });

    it('getEmotionProfiles should return profiles mapped by userId', async () => {
      emotionProfileRepo.find.mockResolvedValueOnce([
        { userId: 'u1', dominantEmotion: 'joy', riskScore: 0.1 },
      ]);

      const res = await service.getEmotionProfiles(['u1']);
      expect(res['u1']).toBeDefined();
      expect(res['u1'].dominantEmotion).toBe('joy');
    });
  });

  describe('Semantic Search & Signal Processing', () => {
    it('listProfileMetadataForFallback should list rows with non-zero dimensions', async () => {
      profileEmbeddingRepo.find.mockResolvedValueOnce([
        {
          userId: 'u1',
          semanticProfileText: 'text',
          dimensions: 384,
          updatedAt: new Date(),
        },
      ]);

      const list = await service.listProfileMetadataForFallback();
      expect(list).toHaveLength(1);
      expect(list[0].userId).toBe('u1');
    });

    it('searchSemanticCandidates should return empty array when viewer embedding is empty', async () => {
      profileEmbeddingRepo.findOneBy.mockResolvedValueOnce(null);

      const res = await service.searchSemanticCandidates('v1', [], 10, 20);
      expect(res).toEqual([]);
    });

    it('searchSemanticCandidates should execute vector query and post-filter candidates', async () => {
      profileEmbeddingRepo.query.mockResolvedValueOnce([
        {
          candidateId: 'c1',
          candidateProfileText: 'cand 1',
          embeddingJson: [0.1, 0.2],
          retrievalScore: 0.85,
        },
      ]);
      // Mock getGraphExcludedCandidateIds dependencies to not exclude c1
      friendshipRepo.find.mockResolvedValueOnce([]);
      blockRepo.find.mockResolvedValueOnce([]);
      pendingRequestRepo.find.mockResolvedValueOnce([]);
      dismissalRepo.find.mockResolvedValueOnce([]);

      const res = await service.searchSemanticCandidates(
        'v1',
        [0.1, 0.2],
        5,
        10,
      );
      expect(res).toHaveLength(1);
      expect(res[0].candidateId).toBe('c1');
      expect(res[0].retrievalScore).toBe(0.85);
    });

    it('refreshGraphPairFeaturesForEvent should refresh pair feature bidirectionally', async () => {
      friendshipRepo.findOneBy.mockResolvedValue(null);
      pendingRequestRepo.findOneBy.mockResolvedValue(null);
      blockRepo.findOneBy.mockResolvedValue(null);
      dismissalRepo.findOneBy.mockResolvedValue(null);
      friendshipRepo.query.mockResolvedValue([]);

      await service.refreshGraphPairFeaturesForEvent(
        'u1',
        'u2',
        'recommendation.graph.friend-request-sent',
        new Date(),
      );

      // Should save pair features for (u1, u2) and (u2, u1)
      expect(pairFeatureRepo.save).toHaveBeenCalledTimes(2);
    });

    it('replaceGlobalFallbackCandidates should save candidates and prune rank overflow', async () => {
      await service.replaceGlobalFallbackCandidates(
        [
          {
            candidateId: 'c1',
            score: 0.9,
            rank: 1,
            locale: 'en',
            language: 'en',
          },
          {
            candidateId: 'c2',
            score: 0.8,
            rank: 2,
            locale: 'en',
            language: 'en',
          },
        ],
        new Date(),
      );

      expect(fallbackRepo.save).toHaveBeenCalled();
      expect(fallbackRepo.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'DELETE FROM recommendation_global_fallback_candidates',
        ),
        expect.any(Array),
      );
    });

    it('getCandidateNegativeSignalCounts should aggregate block and dismissal counts', async () => {
      blockRepo.query.mockResolvedValueOnce([
        { candidateId: 'c1', blockCount: 5 },
      ]);
      dismissalRepo.query.mockResolvedValueOnce([
        { candidateId: 'c1', dismissalCount: 2 },
      ]);

      const signals = await service.getCandidateNegativeSignalCounts([
        'c1',
        'c2',
      ]);
      expect(signals['c1'].blockCount).toBe(5);
      expect(signals['c1'].dismissalCount).toBe(2);
      expect(signals['c2'].blockCount).toBe(0);
      expect(signals['c2'].dismissalCount).toBe(0);
    });
  });
});
