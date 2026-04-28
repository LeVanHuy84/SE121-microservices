import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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

describe('Recommendation query-only integration', () => {
  let controller: FriendshipController;

  const queryCandidates = jest.fn();
  const getUsers = jest.fn();
  const recordRecommendationEvents = jest.fn();
  const summarizeCandidates = jest.fn();
  const getCommonGroupCounts = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    summarizeCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({});

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
            summarizeCandidates,
          },
        },
        {
          provide: GroupClientService,
          useValue: {
            getCommonGroupCounts,
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

  it('should paginate query-only candidates and hydrate users', async () => {
    const cursor = Buffer.from(JSON.stringify({ offset: 2 }), 'utf8').toString(
      'base64url',
    );

    queryCandidates
      .mockResolvedValueOnce({
        viewerId: 'viewer',
        generatedAt: '2026-04-13T10:00:00.000Z',
        source: 'hybrid',
        scoreVersion: 'recommendation-query-pipeline-v1',
        candidateCount: 2,
        nextCursor: cursor,
        hasNextPage: true,
        candidates: [
          {
            candidateId: 'b',
            source: 'semantic_online',
            retrievalScore: 0.82,
            modelScore: 0.91,
            finalScore: 0.87,
            scoreVersion: 'recommendation-query-pipeline-v1',
            reasonCodes: ['semantic_retrieval', 'semantic_rerank'],
            rank: 1,
          },
          {
            candidateId: 'a',
            source: 'global_fallback',
            retrievalScore: 0.72,
            modelScore: 0.74,
            finalScore: 0.73,
            scoreVersion: 'recommendation-query-pipeline-v1',
            reasonCodes: ['global_fallback'],
            rank: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        viewerId: 'viewer',
        generatedAt: '2026-04-13T10:00:02.000Z',
        source: 'hybrid',
        scoreVersion: 'recommendation-query-pipeline-v1',
        candidateCount: 1,
        nextCursor: null,
        hasNextPage: false,
        candidates: [
          {
            candidateId: 'c',
            source: 'global_fallback',
            retrievalScore: 0.3,
            modelScore: 0.4,
            finalScore: 0.34,
            scoreVersion: 'recommendation-query-pipeline-v1',
            reasonCodes: ['global_fallback'],
            rank: 3,
          },
        ],
      });

    getUsers.mockResolvedValue({
      a: { id: 'a', firstName: 'An', lastName: 'Tran', avatarUrl: '' },
      b: { id: 'b', firstName: 'Bao', lastName: 'Le', avatarUrl: '' },
      c: { id: 'c', firstName: 'Chi', lastName: 'Nguyen', avatarUrl: '' },
    });

    const first = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 2 },
    });
    const second = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 1, cursor },
    });

    expect(first.data.map((item) => item.id)).toEqual(['b', 'a']);
    expect(first.hasNextPage).toBe(true);
    expect(first.nextCursor).toBe(cursor);

    expect(second.data.map((item) => item.id)).toEqual(['c']);
    expect(second.hasNextPage).toBe(false);
    expect(second.nextCursor).toBeNull();

    expect(queryCandidates).toHaveBeenNthCalledWith(1, 'viewer', 2, undefined);
    expect(queryCandidates).toHaveBeenNthCalledWith(2, 'viewer', 1, cursor);
    expect(recordRecommendationEvents).toHaveBeenCalledTimes(2);
  });

  it('should return empty page when recommendation-service is unavailable', async () => {
    queryCandidates.mockResolvedValue(null);

    const result = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 5 },
    });

    expect(result).toEqual({
      data: [],
      nextCursor: null,
      hasNextPage: false,
    });
    expect(getUsers).not.toHaveBeenCalled();
    expect(recordRecommendationEvents).not.toHaveBeenCalled();
  });

  it('should reject invalid cursor format', async () => {
    await expect(
      controller.recommendFriends({
        userId: 'viewer',
        query: { limit: 5, cursor: 'invalid-cursor' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(queryCandidates).not.toHaveBeenCalled();
    expect(recordRecommendationEvents).not.toHaveBeenCalled();
  });
});
