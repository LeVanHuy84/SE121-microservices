import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FriendshipController } from '../src/friendship/friendship.controller';
import { FriendshipService } from '../src/friendship/friendship.service';
import { GroupClientService } from '../src/client/group/group-client.service';
import { RecommendationClientService } from '../src/client/recommendation/recommendation-client.service';
import { UserClientService } from '../src/client/user/user-client.service';
import { RecentActivityBufferService } from '../src/event/recent-activity.buffer.service';
import { RecommendationHydrationService } from '../src/friendship/recommendation/recommendation-hydration.service';
import { RecommendationQueryService } from '../src/friendship/recommendation/recommendation-query.service';
import { RecommendationTrackingService } from '../src/friendship/recommendation/recommendation-tracking.service';
import { SOCIAL_GRAPH_REPOSITORY } from '../src/friendship/repositories/social-graph.repository';
import { InMemoryRedis } from './recommendation-test.helpers';

const liveDescribe =
  process.env.RUN_LIVE_SOCIAL_RECOMMENDATION_COMPARE === '1'
    ? describe
    : describe.skip;

liveDescribe('Recommendation live baseline vs live query comparison', () => {
  const createController = async (
    useLiveRecommendationClient: boolean,
  ): Promise<FriendshipController> => {
    const queryCandidates = jest.fn().mockResolvedValue({
      viewerId: 'viewer',
      generatedAt: '2026-04-13T10:00:00.000Z',
      source: 'hybrid',
      scoreVersion: 'recommendation-query-pipeline-v1',
      candidateCount: 4,
      nextCursor: null,
      hasNextPage: false,
      candidates: [
        {
          candidateId: 'semantic-peer',
          source: 'semantic_online',
          retrievalScore: 0.82,
          modelScore: 0.2,
          finalScore: 0.51,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['semantic_retrieval'],
          rank: 1,
        },
        {
          candidateId: 'community-host',
          source: 'global_fallback',
          retrievalScore: 0.76,
          modelScore: 0.15,
          finalScore: 0.46,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['global_fallback'],
          rank: 2,
        },
        {
          candidateId: 'runner-a',
          source: 'semantic_online',
          retrievalScore: 0.63,
          modelScore: 0.1,
          finalScore: 0.38,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['semantic_retrieval'],
          rank: 3,
        },
        {
          candidateId: 'deep-graph',
          source: 'global_fallback',
          retrievalScore: 0.42,
          modelScore: 0.05,
          finalScore: 0.23,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['global_fallback'],
          rank: 4,
        },
      ],
    });

    const getUsers = jest.fn().mockResolvedValue({
      'semantic-peer': {
        id: 'semantic-peer',
        firstName: 'Minh',
        lastName: 'Le',
        avatarUrl: '',
      },
      'community-host': {
        id: 'community-host',
        firstName: 'Giang',
        lastName: 'Ngo',
        avatarUrl: '',
      },
      'runner-a': {
        id: 'runner-a',
        firstName: 'An',
        lastName: 'Pham',
        avatarUrl: '',
      },
      'deep-graph': {
        id: 'deep-graph',
        firstName: 'Hoang',
        lastName: 'Tran',
        avatarUrl: '',
      },
    });

    const configValues = new Map<string, string | number | undefined>([
      [
        'RECOMMENDATION_SERVICE_URL',
        process.env.RECOMMENDATION_SERVICE_URL ?? 'http://127.0.0.1:4011',
      ],
      [
        'RECOMMENDATION_INTERNAL_KEY',
        process.env.INTERNAL_SERVICE_KEY ?? 'recommendation-internal-key-123',
      ],
      ['RECOMMENDATION_SERVICE_TIMEOUT_MS', 30000],
    ]);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FriendshipController],
      providers: [
        FriendshipService,
        RecommendationHydrationService,
        RecommendationQueryService,
        RecommendationTrackingService,
        useLiveRecommendationClient
          ? RecommendationClientService
          : {
              provide: RecommendationClientService,
              useValue: {
                queryCandidates,
              },
            },
        {
          provide: UserClientService,
          useValue: {
            getUsers,
          },
        },
        {
          provide: RecentActivityBufferService,
          useValue: {
            addRecentActivity: jest.fn(),
            clearActivity: jest.fn(),
          },
        },
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            recordRecommendationEvents: jest.fn(),
            summarizeCandidates: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: GroupClientService,
          useValue: {
            getCommonGroupCounts: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: unknown) =>
              configValues.get(key) ?? defaultValue,
          },
        },
        {
          provide: getRedisConnectionToken(),
          useValue: new InMemoryRedis(),
        },
      ],
    }).compile();

    return moduleRef.get(FriendshipController);
  };

  it('should compare mocked baseline with live query pipeline output', async () => {
    const baselineController = await createController(false);
    const liveController = await createController(true);

    const baseline = await baselineController.recommendFriends({
      userId: 'viewer',
      query: { limit: 4 },
    });
    const live = await liveController.recommendFriends({
      userId: 'viewer',
      query: { limit: 4 },
    });

    const baselineRanks = new Map(
      baseline.data.map((candidate, index) => [candidate.id, index + 1]),
    );
    const comparisonRows = live.data.map((candidate, index) => ({
      candidateId: candidate.id,
      baselineRank: baselineRanks.get(candidate.id) ?? 0,
      liveRank: index + 1,
      rankDelta: (baselineRanks.get(candidate.id) ?? 0) - (index + 1),
      retrievalScore: candidate.retrievalScore ?? 0,
      modelScore: candidate.modelScore ?? 0,
      finalScore: candidate.score ?? 0,
    }));

    console.log('\nBaseline vs live query-only comparison');
    console.table(comparisonRows);

    expect(comparisonRows).toHaveLength(4);
  });
});
