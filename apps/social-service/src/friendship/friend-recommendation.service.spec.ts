import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GroupClientService } from '../client/group/group-client.service';
import { UserClientService } from '../client/user/user-client.service';
import { FriendRecommendationService } from './friend-recommendation.service';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';

describe('FriendRecommendationService', () => {
  let service: FriendRecommendationService;
  const recommendFriends = jest.fn();
  const summarizeCandidates = jest.fn();
  const recordRecommendationEvents = jest.fn();
  const getCommonGroupCounts = jest.fn();
  const getGroupRecommendationCandidates = jest.fn();
  const getUserInfos = jest.fn();

  beforeEach(async () => {
    recommendFriends.mockReset();
    summarizeCandidates.mockReset();
    recordRecommendationEvents.mockReset();
    getCommonGroupCounts.mockReset();
    getGroupRecommendationCandidates.mockReset();
    getUserInfos.mockReset();
    getUserInfos.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendRecommendationService,
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            recommendFriends,
            summarizeCandidates,
            recordRecommendationEvents,
          },
        },
        {
          provide: GroupClientService,
          useValue: {
            getCommonGroupCounts,
            getGroupRecommendationCandidates,
          },
        },
        {
          provide: UserClientService,
          useValue: {
            getUserInfos,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FriendRecommendationService>(
      FriendRecommendationService,
    );
  });

  it('should rank recommendations using common group counts', async () => {
    recommendFriends.mockResolvedValue({
      data: [
        { id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] },
        { id: 'a', mutualFriends: 1, mutualFriendIds: ['u1'] },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue([]);
    getGroupRecommendationCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      a: 2,
      b: 0,
    });

    const result = await service.recommendFriends('self', { limit: 2 });

    expect(result.data).toEqual([
      {
        id: 'a',
        mutualFriends: 1,
        mutualFriendIds: ['u1'],
        user: null,
        mutualFriendPreview: [],
        commonGroups: 2,
        score: 22,
        reasons: ['1 mutual friend', '2 common groups'],
        recommendationId: expect.any(String),
        recommendationRequestId: expect.any(String),
      },
      {
        id: 'b',
        mutualFriends: 1,
        mutualFriendIds: ['u2'],
        user: null,
        mutualFriendPreview: [],
        commonGroups: 0,
        score: 10,
        reasons: ['1 mutual friend'],
        recommendationId: expect.any(String),
        recommendationRequestId: expect.any(String),
      },
    ]);
    expect(recordRecommendationEvents).toHaveBeenCalledTimes(1);
    const events = recordRecommendationEvents.mock.calls[0][0];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      userId: 'self',
      candidateId: 'a',
      eventType: 'served',
      metadata: expect.objectContaining({
        mutualFriends: 1,
        commonGroups: 2,
        score: 22,
        position: 0,
      }),
    });
  });

  it('should merge group-based candidates with social graph candidates', async () => {
    recommendFriends.mockResolvedValue({
      data: [{ id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] }],
      nextCursor: null,
      hasNextPage: false,
    });
    getGroupRecommendationCandidates.mockResolvedValue([
      { id: 'c', commonGroups: 3 },
    ]);
    summarizeCandidates.mockResolvedValue([
      { id: 'c', mutualFriends: 0, mutualFriendIds: [] },
    ]);
    getCommonGroupCounts.mockResolvedValue({
      b: 0,
      c: 3,
    });

    const result = await service.recommendFriends('self', { limit: 2 });

    expect(result.data).toEqual([
      {
        id: 'c',
        mutualFriends: 0,
        mutualFriendIds: [],
        user: null,
        mutualFriendPreview: [],
        commonGroups: 3,
        score: 18,
        reasons: ['3 common groups'],
        recommendationId: expect.any(String),
        recommendationRequestId: expect.any(String),
      },
      {
        id: 'b',
        mutualFriends: 1,
        mutualFriendIds: ['u2'],
        user: null,
        mutualFriendPreview: [],
        commonGroups: 0,
        score: 10,
        reasons: ['1 mutual friend'],
        recommendationId: expect.any(String),
        recommendationRequestId: expect.any(String),
      },
    ]);
  });

  it('should hydrate visible candidates with user snapshots', async () => {
    recommendFriends.mockResolvedValue({
      data: [{ id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] }],
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue([]);
    getGroupRecommendationCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({ b: 0 });
    getUserInfos.mockResolvedValue({
      b: {
        id: 'b',
        firstName: 'Bao',
        lastName: 'Tran',
        avatarUrl: 'https://cdn.example.com/b.jpg',
      },
      u2: {
        id: 'u2',
        firstName: 'Minh',
        lastName: 'Le',
        avatarUrl: 'https://cdn.example.com/u2.jpg',
      },
    });

    const result = await service.recommendFriends('self', { limit: 1 });

    expect(result.data[0]).toMatchObject({
      id: 'b',
      recommendationId: expect.any(String),
      recommendationRequestId: expect.any(String),
      user: {
        id: 'b',
        firstName: 'Bao',
        lastName: 'Tran',
      },
      mutualFriendPreview: [
        {
          id: 'u2',
          firstName: 'Minh',
          lastName: 'Le',
        },
      ],
    });
    expect(getUserInfos).toHaveBeenCalledWith(['b', 'u2']);
  });

  it('should paginate using ranked recommendation order', async () => {
    recommendFriends.mockResolvedValue({
      data: [
        { id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] },
        { id: 'c', mutualFriends: 1, mutualFriendIds: ['u3'] },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    getGroupRecommendationCandidates.mockResolvedValue([
      { id: 'a', commonGroups: 3 },
    ]);
    summarizeCandidates.mockResolvedValue([
      { id: 'a', mutualFriends: 0, mutualFriendIds: [] },
    ]);
    getCommonGroupCounts.mockResolvedValue({
      a: 3,
      b: 0,
      c: 0,
    });

    const firstPage = await service.recommendFriends('self', { limit: 1 });
    const secondPage = await service.recommendFriends('self', {
      limit: 1,
      cursor: 'a',
    });

    expect(firstPage.data.map((candidate) => candidate.id)).toEqual(['a']);
    expect(secondPage.data.map((candidate) => candidate.id)).toEqual(['b']);
    expect(recommendFriends).toHaveBeenNthCalledWith(2, 'self', {
      limit: 100,
      cursor: undefined,
    });
    expect(recordRecommendationEvents).toHaveBeenCalledTimes(2);
  });

  it('should cap signal contributions using scoring config defaults', async () => {
    recommendFriends.mockResolvedValue({
      data: [
        {
          id: 'heavy-social',
          mutualFriends: 9,
          mutualFriendIds: ['u1', 'u2', 'u3'],
        },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue([]);
    getGroupRecommendationCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      'heavy-social': 6,
    });

    const result = await service.recommendFriends('self', { limit: 1 });

    expect(result.data[0]).toMatchObject({
      id: 'heavy-social',
      mutualFriends: 9,
      commonGroups: 6,
      score: 68,
      reasons: ['9 mutual friends', '6 common groups'],
    });
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'self',
        candidateId: 'heavy-social',
        eventType: 'served',
        metadata: expect.objectContaining({
          score: 68,
        }),
      }),
    ]);
  });

  it('should diversify repeated mutual-friend clusters in ranked order', async () => {
    recommendFriends.mockResolvedValue({
      data: [
        { id: 'a', mutualFriends: 1, mutualFriendIds: ['u1'] },
        { id: 'b', mutualFriends: 1, mutualFriendIds: ['u1'] },
        { id: 'c', mutualFriends: 1, mutualFriendIds: ['u2'] },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue([]);
    getGroupRecommendationCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      a: 0,
      b: 0,
      c: 0,
    });

    const result = await service.recommendFriends('self', { limit: 3 });

    expect(result.data.map((candidate) => candidate.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        candidateId: 'a',
        metadata: expect.objectContaining({
          source: 'mutual_only',
          position: 0,
        }),
      }),
      expect.objectContaining({
        candidateId: 'c',
        metadata: expect.objectContaining({
          source: 'mutual_only',
          position: 1,
        }),
      }),
      expect.objectContaining({
        candidateId: 'b',
        metadata: expect.objectContaining({
          source: 'mutual_only',
          position: 2,
        }),
      }),
    ]);
  });
});
