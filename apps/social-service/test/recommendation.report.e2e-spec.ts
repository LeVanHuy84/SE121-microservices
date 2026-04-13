import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { Test, TestingModule } from '@nestjs/testing';
import { FriendshipController } from '../src/friendship/friendship.controller';
import { FriendshipService } from '../src/friendship/friendship.service';
import { RecommendationClientService } from '../src/client/recommendation/recommendation-client.service';
import { UserClientService } from '../src/client/user/user-client.service';
import { RecentActivityBufferService } from '../src/event/recent-activity.buffer.service';
import { RecommendationHydrationService } from '../src/friendship/recommendation/recommendation-hydration.service';
import { RecommendationQueryService } from '../src/friendship/recommendation/recommendation-query.service';
import { RecommendationTrackingService } from '../src/friendship/recommendation/recommendation-tracking.service';
import { SOCIAL_GRAPH_REPOSITORY } from '../src/friendship/repositories/social-graph.repository';
import { InMemoryRedis } from './recommendation-test.helpers';

describe('Recommendation query report', () => {
  let controller: FriendshipController;

  const queryCandidates = jest.fn();
  const getUsers = jest.fn();
  const recordRecommendationEvents = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FriendshipController],
      providers: [
        FriendshipService,
        RecommendationHydrationService,
        RecommendationQueryService,
        RecommendationTrackingService,
        {
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
            recordRecommendationEvents,
          },
        },
        {
          provide: getRedisConnectionToken(),
          useValue: new InMemoryRedis(),
        },
      ],
    }).compile();

    controller = moduleRef.get(FriendshipController);
  });

  it('should print query-only ranking report', async () => {
    queryCandidates.mockResolvedValue({
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
          modelScore: 0.91,
          finalScore: 0.87,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['semantic_retrieval', 'semantic_rerank'],
          rank: 1,
        },
        {
          candidateId: 'community-host',
          source: 'precomputed',
          retrievalScore: 0.76,
          modelScore: 0.71,
          finalScore: 0.74,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['precomputed_snapshot'],
          rank: 2,
        },
        {
          candidateId: 'runner-a',
          source: 'semantic_online',
          retrievalScore: 0.63,
          modelScore: 0.66,
          finalScore: 0.64,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['semantic_retrieval'],
          rank: 3,
        },
        {
          candidateId: 'deep-graph',
          source: 'global_fallback',
          retrievalScore: 0.42,
          modelScore: 0.4,
          finalScore: 0.41,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['global_fallback'],
          rank: 4,
        },
      ],
    });

    getUsers.mockResolvedValue({
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
      'runner-a': { id: 'runner-a', firstName: 'An', lastName: 'Pham', avatarUrl: '' },
      'deep-graph': {
        id: 'deep-graph',
        firstName: 'Hoang',
        lastName: 'Tran',
        avatarUrl: '',
      },
    });

    const result = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 4 },
    });

    const rows = result.data.map((candidate, index) => ({
      rank: index + 1,
      candidateId: candidate.id,
      sourceMode: candidate.candidateSourceMode,
      retrievalScore: candidate.retrievalScore ?? 0,
      modelScore: candidate.modelScore ?? 0,
      finalScore: candidate.score ?? 0,
      reasons: (candidate.reasons ?? []).join(' | '),
    }));

    console.log('\nQuery-only recommendation report');
    console.table(rows);

    expect(rows.map((row) => row.candidateId)).toEqual([
      'semantic-peer',
      'community-host',
      'runner-a',
      'deep-graph',
    ]);
    expect(recordRecommendationEvents).toHaveBeenCalledTimes(1);
  });
});
