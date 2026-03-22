import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GroupClientService } from '../client/group/group-client.service';
import { RecommendationClientService } from '../client/recommendation/recommendation-client.service';
import { UserClientService } from '../client/user/user-client.service';
import { RecentActivityBufferService } from '../event/recent-activity.buffer.service';
import { CandidateSourceService } from './recommendation/candidate-source.service';
import { RecommendationBaselineRankerService } from './recommendation/recommendation-baseline-ranker.service';
import { RecommendationDiversityService } from './recommendation/recommendation-diversity.service';
import { RecommendationFeatureService } from './recommendation/recommendation-feature.service';
import { RecommendationHydrationService } from './recommendation/recommendation-hydration.service';
import { RecommendationQueryService } from './recommendation/recommendation-query.service';
import { RecommendationSnapshotService } from './recommendation/recommendation-snapshot.service';
import { RecommendationTrackingService } from './recommendation/recommendation-tracking.service';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';

describe('RecommendationQueryService', () => {
  let service: RecommendationQueryService;
  const recommendFriends = jest.fn();
  const summarizeCandidates = jest.fn();
  const recordRecommendationEvents = jest.fn();
  const getCommonGroupCounts = jest.fn();
  const getCommonGroupNames = jest.fn();
  const getGroupRecommendationCandidates = jest.fn();
  const rerankCandidates = jest.fn();
  const createSnapshotPage = jest.fn();
  const getSnapshotPage = jest.fn();
  const getGraphContinuationCursor = jest.fn();
  const getUsers = jest.fn();
  const getProfileRecommendationCandidates = jest.fn();
  const getRecentInteractionScores = jest.fn();
  const configGet = jest.fn();
  let snapshotRecommendations: unknown[] = [];
  let snapshotGraphContinuationCursor: string | null = null;

  beforeEach(async () => {
    recommendFriends.mockReset();
    summarizeCandidates.mockReset();
    recordRecommendationEvents.mockReset();
    getCommonGroupCounts.mockReset();
    getCommonGroupNames.mockReset();
    getGroupRecommendationCandidates.mockReset();
    rerankCandidates.mockReset();
    createSnapshotPage.mockReset();
    getSnapshotPage.mockReset();
    getGraphContinuationCursor.mockReset();
    getUsers.mockReset();
    getProfileRecommendationCandidates.mockReset();
    getRecentInteractionScores.mockReset();
    configGet.mockReset();
    snapshotRecommendations = [];
    snapshotGraphContinuationCursor = null;
    getUsers.mockResolvedValue({});
    getProfileRecommendationCandidates.mockResolvedValue([]);
    getCommonGroupNames.mockResolvedValue({});
    rerankCandidates.mockResolvedValue({});
    getRecentInteractionScores.mockResolvedValue({});
    configGet.mockImplementation(() => undefined);
    createSnapshotPage.mockImplementation(
      async (
        _userId: string,
        recommendations: unknown[],
        limit: number,
        continuationGraphCursor: string | null,
      ) => {
        snapshotRecommendations = recommendations;
        snapshotGraphContinuationCursor = continuationGraphCursor;
        const data = recommendations.slice(0, limit);
        const nextIndex = data.length;
        const hasNextPage =
          nextIndex < recommendations.length ||
          Boolean(continuationGraphCursor);
        return {
          data,
          nextCursor:
            nextIndex < recommendations.length
              ? `snapshot:${nextIndex}`
              : continuationGraphCursor
                ? `graph:${continuationGraphCursor}`
                : null,
          hasNextPage,
          startIndex: 0,
        };
      },
    );
    getSnapshotPage.mockImplementation(
      async (_userId: string, cursor: string, limit: number) => {
        const [, rawStartIndex] = cursor.split(':');
        const startIndex = Number(rawStartIndex);
        if (!Number.isFinite(startIndex)) {
          return null;
        }

        const data = snapshotRecommendations.slice(startIndex, startIndex + limit);
        const nextIndex = startIndex + data.length;
        const hasNextPage =
          nextIndex < snapshotRecommendations.length ||
          Boolean(snapshotGraphContinuationCursor);
        return {
          data,
          nextCursor:
            nextIndex < snapshotRecommendations.length
              ? `snapshot:${nextIndex}`
              : snapshotGraphContinuationCursor
                ? `graph:${snapshotGraphContinuationCursor}`
                : null,
          hasNextPage,
          startIndex,
        };
      },
    );
    getGraphContinuationCursor.mockImplementation((cursor: string) => {
      const [, graphCursor] = cursor.split(':');
      return graphCursor || null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateSourceService,
        RecommendationBaselineRankerService,
        RecommendationDiversityService,
        RecommendationFeatureService,
        RecommendationHydrationService,
        RecommendationQueryService,
        {
          provide: RecommendationSnapshotService,
          useValue: {
            createSnapshotPage,
            getSnapshotPage,
            getGraphContinuationCursor,
          },
        },
        RecommendationTrackingService,
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
            getCommonGroupNames,
            getGroupRecommendationCandidates,
          },
        },
        {
          provide: RecommendationClientService,
          useValue: {
            rerankCandidates,
          },
        },
        {
          provide: UserClientService,
          useValue: {
            getUsers,
            getProfileRecommendationCandidates,
          },
        },
        {
          provide: RecentActivityBufferService,
          useValue: {
            getRecentInteractionScores,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: configGet,
          },
        },
      ],
    }).compile();

    service = module.get<RecommendationQueryService>(
      RecommendationQueryService,
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
        baseScore: 0.233333,
        score: 0.233333,
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
        baseScore: 0.1,
        score: 0.1,
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
        score: 0.233333,
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
        baseScore: 0.2,
        score: 0.2,
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
        baseScore: 0.1,
        score: 0.1,
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
    getUsers.mockResolvedValue({
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
      baseScore: 0.1,
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
    expect(getUsers).toHaveBeenCalledWith(['b', 'u2'], 'base');
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
      cursor: firstPage.nextCursor ?? '',
    });

    expect(firstPage.data.map((candidate) => candidate.id)).toEqual(['a']);
    expect(secondPage.data.map((candidate) => candidate.id)).toEqual(['b']);
    expect(firstPage.nextCursor).toBe('snapshot:1');
    expect(recommendFriends).toHaveBeenCalledTimes(1);
    expect(recordRecommendationEvents).toHaveBeenCalledTimes(2);
  });

  it('should continue pagination into the next graph window after snapshot pages are exhausted', async () => {
    recommendFriends
      .mockResolvedValueOnce({
        data: [{ id: 'a', mutualFriends: 2, mutualFriendIds: ['u1'] }],
        nextCursor: 'graph-window-2',
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] }],
        nextCursor: null,
        hasNextPage: false,
      });
    summarizeCandidates.mockResolvedValue([]);
    getGroupRecommendationCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      a: 0,
      b: 0,
    });

    const firstPage = await service.recommendFriends('self', { limit: 1 });
    const secondPage = await service.recommendFriends('self', {
      limit: 1,
      cursor: firstPage.nextCursor ?? '',
    });

    expect(firstPage.data.map((candidate) => candidate.id)).toEqual(['a']);
    expect(firstPage.nextCursor).toBe('graph:graph-window-2');
    expect(firstPage.hasNextPage).toBe(true);
    expect(secondPage.data.map((candidate) => candidate.id)).toEqual(['b']);
    expect(recommendFriends).toHaveBeenNthCalledWith(1, 'self', {
      cursor: undefined,
      limit: 5,
    });
    expect(recommendFriends).toHaveBeenNthCalledWith(2, 'self', {
      cursor: 'graph-window-2',
      limit: 5,
    });
  });

  it('should reject an invalid or expired recommendation cursor', async () => {
    await expect(
      service.recommendFriends('self', {
        limit: 1,
        cursor: 'expired-cursor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(recommendFriends).not.toHaveBeenCalled();
    expect(recordRecommendationEvents).not.toHaveBeenCalled();
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
      score: 0.7,
      reasons: ['9 mutual friends', '6 common groups'],
    });
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'self',
        candidateId: 'heavy-social',
        eventType: 'served',
        metadata: expect.objectContaining({
          baseScore: 0.7,
          score: 0.7,
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

  it('should combine AI rerank score with base score when enabled', async () => {
    configGet.mockImplementation((key: string) => {
      switch (key) {
        case 'FRIEND_RECOMMEND_AI_WEIGHT':
          return '0.5';
        case 'FRIEND_RECOMMEND_AI_TOP_K':
          return '5';
        default:
          return undefined;
      }
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CandidateSourceService,
        RecommendationBaselineRankerService,
        RecommendationDiversityService,
        RecommendationFeatureService,
        RecommendationHydrationService,
        RecommendationQueryService,
        {
          provide: RecommendationSnapshotService,
          useValue: {
            createSnapshotPage,
            getSnapshotPage,
            getGraphContinuationCursor,
          },
        },
        RecommendationTrackingService,
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
            getCommonGroupNames,
            getGroupRecommendationCandidates,
          },
        },
        {
          provide: RecommendationClientService,
          useValue: {
            rerankCandidates,
          },
        },
        {
          provide: UserClientService,
          useValue: {
            getUsers,
            getProfileRecommendationCandidates,
          },
        },
        {
          provide: RecentActivityBufferService,
          useValue: {
            getRecentInteractionScores,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: configGet,
          },
        },
      ],
    }).compile();

    service = module.get<RecommendationQueryService>(
      RecommendationQueryService,
    );

    recommendFriends.mockResolvedValue({
      data: [
        { id: 'a', mutualFriends: 1, mutualFriendIds: ['u1'] },
        { id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue([]);
    getGroupRecommendationCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      a: 0,
      b: 0,
    });
    rerankCandidates.mockResolvedValue({
      a: 0.1,
      b: 0.9,
    });
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') => {
      if (projection === 'full') {
        return Promise.resolve({
          self: {
            id: 'self',
            email: 'self@example.com',
            isActive: true,
            firstName: 'Self',
            lastName: 'User',
            avatarUrl: '',
            bio: 'I build social apps',
            location: 'Ho Chi Minh City',
            jobTitle: 'Platform Engineer',
            company: 'Acme Social',
            school: 'HCMUT',
            interests: ['backend', 'running'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          a: {
            id: 'a',
            email: 'a@example.com',
            isActive: true,
            firstName: 'Anh',
            lastName: 'Tran',
            avatarUrl: '',
            bio: 'Mobile developer and runner',
            location: 'Da Nang',
            jobTitle: 'Mobile Developer',
            company: 'Pixel Labs',
            school: 'DUT',
            interests: ['react native', 'running'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          b: {
            id: 'b',
            email: 'b@example.com',
            isActive: true,
            firstName: 'Binh',
            lastName: 'Le',
            avatarUrl: '',
            bio: 'Mobile developer and designer',
            location: 'Ho Chi Minh City',
            jobTitle: 'Product Designer',
            company: 'Studio Nine',
            school: 'UEH',
            interests: ['design systems', 'mobile apps'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        });
      }

      return Promise.resolve({
        u1: {
          id: 'u1',
          firstName: 'Minh',
          lastName: 'Le',
          avatarUrl: '',
        },
        u2: {
          id: 'u2',
          firstName: 'Bao',
          lastName: 'Tran',
          avatarUrl: '',
        },
      });
    });
    getCommonGroupNames.mockResolvedValue({
      a: ['React Builders'],
      b: ['Mobile Dev VN'],
    });

    const result = await service.recommendFriends('self', { limit: 2 });

    expect(getUsers).toHaveBeenCalledWith(['self', 'a', 'b'], 'full');
    expect(getUsers).toHaveBeenCalledWith(['u1', 'u2'], 'base');
    expect(getCommonGroupNames).toHaveBeenCalledWith('self', ['a', 'b'], 3);
    expect(rerankCandidates).toHaveBeenCalledWith(
      'self',
      [
        {
          candidateId: 'a',
          mutualFriends: 1,
          commonGroups: 0,
          candidateProfileText:
            'name: Anh Tran\nbio: Mobile developer and runner\nlocation: Da Nang\nwork: Mobile Developer at Pixel Labs\nschool: DUT\ninterests: react native, running\nsocial context: 1 mutual friends\nconnected with: Minh Le\ncommon groups: React Builders',
        },
        {
          candidateId: 'b',
          mutualFriends: 1,
          commonGroups: 0,
          candidateProfileText:
            'name: Binh Le\nbio: Mobile developer and designer\nlocation: Ho Chi Minh City\nwork: Product Designer at Studio Nine\nschool: UEH\ninterests: design systems, mobile apps\nsocial context: 1 mutual friends\nconnected with: Bao Tran\ncommon groups: Mobile Dev VN',
        },
      ],
      'name: Self User\nbio: I build social apps\nlocation: Ho Chi Minh City\nwork: Platform Engineer at Acme Social\nschool: HCMUT\ninterests: backend, running',
    );
    expect(result.data.map((candidate) => candidate.id)).toEqual(['b', 'a']);
    expect(result.data[0]).toMatchObject({
      id: 'b',
      baseScore: 0.1,
      modelScore: 0.9,
      score: 0.55,
    });
  });

  it('should boost candidates with recent interaction score', async () => {
    recommendFriends.mockResolvedValue({
      data: [
        { id: 'a', mutualFriends: 1, mutualFriendIds: ['u1'] },
        { id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue([]);
    getGroupRecommendationCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      a: 0,
      b: 0,
    });
    getRecentInteractionScores.mockResolvedValue({
      a: 0.8,
      b: 0,
    });

    const result = await service.recommendFriends('self', { limit: 2 });

    expect(getRecentInteractionScores).toHaveBeenCalledWith('self', ['a', 'b']);
    expect(result.data.map((candidate) => candidate.id)).toEqual(['a', 'b']);
    expect(result.data[0]).toMatchObject({
      id: 'a',
      baseScore: 0.34,
      score: 0.34,
    });
  });
});
