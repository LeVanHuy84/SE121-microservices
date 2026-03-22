import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FriendshipController } from '../src/friendship/friendship.controller';
import { FriendshipService } from '../src/friendship/friendship.service';
import { GroupClientService } from '../src/client/group/group-client.service';
import { RecommendationClientService } from '../src/client/recommendation/recommendation-client.service';
import { UserClientService } from '../src/client/user/user-client.service';
import { RecentActivityBufferService } from '../src/event/recent-activity.buffer.service';
import { CandidateSourceService } from '../src/friendship/recommendation/candidate-source.service';
import { RecommendationBaselineRankerService } from '../src/friendship/recommendation/recommendation-baseline-ranker.service';
import { RecommendationDiversityService } from '../src/friendship/recommendation/recommendation-diversity.service';
import { RecommendationFeatureService } from '../src/friendship/recommendation/recommendation-feature.service';
import { RecommendationHydrationService } from '../src/friendship/recommendation/recommendation-hydration.service';
import { RecommendationQueryService } from '../src/friendship/recommendation/recommendation-query.service';
import { RecommendationSnapshotService } from '../src/friendship/recommendation/recommendation-snapshot.service';
import { RecommendationTrackingService } from '../src/friendship/recommendation/recommendation-tracking.service';
import { SOCIAL_GRAPH_REPOSITORY } from '../src/friendship/repositories/social-graph.repository';
import {
  buildMultiUserRecommendationFixture,
  InMemoryRedis,
  resolveFixtureUsers,
} from './recommendation-test.helpers';

describe('Recommendation flow integration', () => {
  let controller: FriendshipController;

  const recommendFriends = jest.fn();
  const summarizeCandidates = jest.fn();
  const recordRecommendationEvents = jest.fn();
  const getCommonGroupCounts = jest.fn();
  const getCommonGroupNames = jest.fn();
  const getGroupRecommendationCandidates = jest.fn();
  const rerankCandidates = jest.fn();
  const getUsers = jest.fn();
  const getProfileRecommendationCandidates = jest.fn();
  const getRecentInteractionScores = jest.fn();
  const addRecentActivity = jest.fn();
  const clearActivity = jest.fn();
  const configGet = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    getCommonGroupCounts.mockResolvedValue({});
    getCommonGroupNames.mockResolvedValue({});
    getGroupRecommendationCandidates.mockResolvedValue([]);
    rerankCandidates.mockResolvedValue({});
    getUsers.mockResolvedValue({});
    getProfileRecommendationCandidates.mockResolvedValue([]);
    getRecentInteractionScores.mockResolvedValue({});
    addRecentActivity.mockResolvedValue(undefined);
    clearActivity.mockResolvedValue(undefined);
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

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [FriendshipController],
      providers: [
        FriendshipService,
        CandidateSourceService,
        RecommendationBaselineRankerService,
        RecommendationDiversityService,
        RecommendationFeatureService,
        RecommendationHydrationService,
        RecommendationQueryService,
        RecommendationSnapshotService,
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
            addRecentActivity,
            clearActivity,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: configGet,
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

  it('should paginate across snapshot pages and continue into the next graph window', async () => {
    recommendFriends
      .mockResolvedValueOnce({
        data: [
          { id: 'a', mutualFriends: 1, mutualFriendIds: ['u1'] },
          { id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] },
        ],
        nextCursor: 'graph-window-2',
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        data: [{ id: 'c', mutualFriends: 1, mutualFriendIds: ['u3'] }],
        nextCursor: null,
        hasNextPage: false,
      });

    summarizeCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      a: 0,
      b: 0,
      c: 0,
    });
    rerankCandidates.mockResolvedValue({
      a: 0.1,
      b: 0.9,
      c: 0.2,
    });
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') => {
      if (projection === 'full') {
        return Promise.resolve({
          viewer: {
            id: 'viewer',
            email: 'viewer@example.com',
            isActive: true,
            firstName: 'Vinh',
            lastName: 'Co',
            avatarUrl: '',
            bio: 'Backend engineer and runner',
            location: 'Ho Chi Minh City',
            jobTitle: 'Backend Engineer',
            company: 'Acme Social',
            school: 'HCMUT',
            interests: ['Công nghệ', 'Chạy bộ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          a: {
            id: 'a',
            email: 'a@example.com',
            isActive: true,
            firstName: 'An',
            lastName: 'Tran',
            avatarUrl: '',
            bio: 'Works on mobile apps',
            location: 'Da Nang',
            jobTitle: 'Mobile Engineer',
            company: 'Pixel Labs',
            school: 'DUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          b: {
            id: 'b',
            email: 'b@example.com',
            isActive: true,
            firstName: 'Binh',
            lastName: 'Le',
            avatarUrl: '',
            bio: 'Designs social products',
            location: 'Ho Chi Minh City',
            jobTitle: 'Product Designer',
            company: 'Studio Nine',
            school: 'UEH',
            interests: ['Thiết kế', 'Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          c: {
            id: 'c',
            email: 'c@example.com',
            isActive: true,
            firstName: 'Chi',
            lastName: 'Nguyen',
            avatarUrl: '',
            bio: 'Runs community events',
            location: 'Hue',
            jobTitle: 'Community Manager',
            company: 'Social Hub',
            school: 'Hue University',
            interests: ['Tình nguyện'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        });
      }

      return Promise.resolve({
        a: { id: 'a', firstName: 'An', lastName: 'Tran', avatarUrl: '' },
        b: { id: 'b', firstName: 'Binh', lastName: 'Le', avatarUrl: '' },
        c: { id: 'c', firstName: 'Chi', lastName: 'Nguyen', avatarUrl: '' },
        u1: { id: 'u1', firstName: 'Minh', lastName: 'Le', avatarUrl: '' },
        u2: { id: 'u2', firstName: 'Bao', lastName: 'Tran', avatarUrl: '' },
        u3: { id: 'u3', firstName: 'Lan', lastName: 'Pham', avatarUrl: '' },
      });
    });
    getCommonGroupNames.mockResolvedValue({
      a: ['Mobile Builders'],
      b: ['Design Circle'],
      c: ['Community Hub'],
    });

    const firstPage = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 1 },
    });

    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.data[0].id).toBe('b');
    expect(firstPage.nextCursor).toBeTruthy();
    expect(recommendFriends).toHaveBeenCalledTimes(1);

    const secondPage = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 1, cursor: firstPage.nextCursor ?? undefined },
    });

    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.data[0].id).toBe('a');
    expect(secondPage.nextCursor).toBeTruthy();
    expect(recommendFriends).toHaveBeenCalledTimes(1);

    const thirdPage = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 1, cursor: secondPage.nextCursor ?? undefined },
    });

    expect(thirdPage.data).toHaveLength(1);
    expect(thirdPage.data[0].id).toBe('c');
    expect(recommendFriends).toHaveBeenCalledTimes(2);
    expect(recommendFriends).toHaveBeenNthCalledWith(1, 'viewer', {
      cursor: undefined,
      limit: 5,
    });
    expect(recommendFriends).toHaveBeenNthCalledWith(2, 'viewer', {
      cursor: 'graph-window-2',
      limit: 5,
    });
    expect(rerankCandidates).toHaveBeenCalledTimes(2);
    expect(recordRecommendationEvents).toHaveBeenCalledTimes(3);
  });

  it('should reject an invalid recommendation cursor', async () => {
    await expect(
      controller.recommendFriends({
        userId: 'viewer',
        query: { limit: 1, cursor: 'not-a-valid-cursor' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(recommendFriends).not.toHaveBeenCalled();
    expect(recordRecommendationEvents).not.toHaveBeenCalled();
  });

  it('should fall back to baseline ranking when AI scoring returns no scores', async () => {
    recommendFriends.mockResolvedValue({
      data: [
        { id: 'a', mutualFriends: 1, mutualFriendIds: ['u1'] },
        { id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      a: 2,
      b: 0,
    });
    rerankCandidates.mockResolvedValue({});
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') => {
      if (projection === 'full') {
        return Promise.resolve({
          viewer: {
            id: 'viewer',
            email: 'viewer@example.com',
            isActive: true,
            firstName: 'Vinh',
            lastName: 'Co',
            avatarUrl: '',
            bio: 'Backend engineer',
            location: 'Ho Chi Minh City',
            jobTitle: 'Backend Engineer',
            company: 'Acme Social',
            school: 'HCMUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          a: {
            id: 'a',
            email: 'a@example.com',
            isActive: true,
            firstName: 'An',
            lastName: 'Tran',
            avatarUrl: '',
            bio: 'Builds mobile products',
            location: 'Da Nang',
            jobTitle: 'Mobile Engineer',
            company: 'Pixel Labs',
            school: 'DUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          b: {
            id: 'b',
            email: 'b@example.com',
            isActive: true,
            firstName: 'Bao',
            lastName: 'Le',
            avatarUrl: '',
            bio: 'Writes product copy',
            location: 'Hue',
            jobTitle: 'Content Writer',
            company: 'Studio Nine',
            school: 'Hue University',
            interests: ['Marketing'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        });
      }

      return Promise.resolve({
        a: { id: 'a', firstName: 'An', lastName: 'Tran', avatarUrl: '' },
        b: { id: 'b', firstName: 'Bao', lastName: 'Le', avatarUrl: '' },
        u1: { id: 'u1', firstName: 'Minh', lastName: 'Le', avatarUrl: '' },
        u2: { id: 'u2', firstName: 'Lan', lastName: 'Pham', avatarUrl: '' },
      });
    });
    getCommonGroupNames.mockResolvedValue({
      a: ['Mobile Builders'],
      b: ['Content Circle'],
    });

    const result = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 2 },
    });

    expect(result.data.map((candidate) => candidate.id)).toEqual(['a', 'b']);
    expect(result.data[0]).toMatchObject({
      id: 'a',
      commonGroups: 2,
      baseScore: 0.233333,
      score: 0.233333,
    });
    expect(result.data[1]).toMatchObject({
      id: 'b',
      commonGroups: 0,
      baseScore: 0.1,
      score: 0.1,
    });
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        candidateId: 'a',
        metadata: expect.objectContaining({
          baseScore: 0.233333,
          modelScore: null,
          score: 0.233333,
          source: 'mixed',
          position: 0,
        }),
      }),
      expect.objectContaining({
        candidateId: 'b',
        metadata: expect.objectContaining({
          baseScore: 0.1,
          modelScore: null,
          score: 0.1,
          source: 'mutual_only',
          position: 1,
        }),
      }),
    ]);
  });

  it('should merge group-only candidates and hydrate them correctly on the first window', async () => {
    recommendFriends.mockResolvedValue({
      data: [{ id: 'a', mutualFriends: 1, mutualFriendIds: ['u1'] }],
      nextCursor: null,
      hasNextPage: false,
    });
    getGroupRecommendationCandidates.mockResolvedValue([
      { id: 'g1', commonGroups: 3 },
    ]);
    summarizeCandidates.mockResolvedValue([
      { id: 'g1', mutualFriends: 0, mutualFriendIds: [] },
    ]);
    getCommonGroupCounts.mockResolvedValue({
      a: 0,
      g1: 3,
    });
    rerankCandidates.mockResolvedValue({
      a: 0.1,
      g1: 0.2,
    });
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') => {
      if (projection === 'full') {
        return Promise.resolve({
          viewer: {
            id: 'viewer',
            email: 'viewer@example.com',
            isActive: true,
            firstName: 'Vinh',
            lastName: 'Co',
            avatarUrl: '',
            bio: 'Backend engineer',
            location: 'Ho Chi Minh City',
            jobTitle: 'Backend Engineer',
            company: 'Acme Social',
            school: 'HCMUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          a: {
            id: 'a',
            email: 'a@example.com',
            isActive: true,
            firstName: 'An',
            lastName: 'Tran',
            avatarUrl: '',
            bio: 'Builds mobile products',
            location: 'Da Nang',
            jobTitle: 'Mobile Engineer',
            company: 'Pixel Labs',
            school: 'DUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          g1: {
            id: 'g1',
            email: 'g1@example.com',
            isActive: true,
            firstName: 'Giang',
            lastName: 'Nguyen',
            avatarUrl: '',
            bio: 'Runs design meetups',
            location: 'Ho Chi Minh City',
            jobTitle: 'Community Host',
            company: 'Creative Hub',
            school: 'UEH',
            interests: ['Thiết kế', 'Tình nguyện'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        });
      }

      return Promise.resolve({
        a: { id: 'a', firstName: 'An', lastName: 'Tran', avatarUrl: '' },
        g1: { id: 'g1', firstName: 'Giang', lastName: 'Nguyen', avatarUrl: '' },
        u1: { id: 'u1', firstName: 'Minh', lastName: 'Le', avatarUrl: '' },
      });
    });
    getCommonGroupNames.mockResolvedValue({
      a: ['Mobile Builders'],
      g1: ['Design Circle', 'Community Hub', 'Volunteer Club'],
    });

    const result = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 2 },
    });

    expect(result.data.map((candidate) => candidate.id)).toEqual(['g1', 'a']);
    expect(result.data[0]).toMatchObject({
      id: 'g1',
      commonGroups: 3,
      user: {
        id: 'g1',
        firstName: 'Giang',
        lastName: 'Nguyen',
      },
      mutualFriendPreview: [],
      reasons: ['3 common groups'],
    });
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        candidateId: 'g1',
        metadata: expect.objectContaining({
          commonGroups: 3,
          source: 'group_only',
          position: 0,
        }),
      }),
      expect.objectContaining({
        candidateId: 'a',
        metadata: expect.objectContaining({
          source: 'mutual_only',
          position: 1,
        }),
      }),
    ]);
  });

  it('should ignore recent interaction score in the integrated flow when interaction weight is disabled', async () => {
    recommendFriends.mockResolvedValue({
      data: [
        { id: 'a', mutualFriends: 1, mutualFriendIds: ['u1'] },
        { id: 'b', mutualFriends: 1, mutualFriendIds: ['u2'] },
      ],
      nextCursor: null,
      hasNextPage: false,
    });
    summarizeCandidates.mockResolvedValue([]);
    getCommonGroupCounts.mockResolvedValue({
      a: 0,
      b: 0,
    });
    getRecentInteractionScores.mockResolvedValue({
      a: 0.8,
      b: 0,
    });
    rerankCandidates.mockResolvedValue({});
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') => {
      if (projection === 'full') {
        return Promise.resolve({
          viewer: {
            id: 'viewer',
            email: 'viewer@example.com',
            isActive: true,
            firstName: 'Vinh',
            lastName: 'Co',
            avatarUrl: '',
            bio: 'Backend engineer',
            location: 'Ho Chi Minh City',
            jobTitle: 'Backend Engineer',
            company: 'Acme Social',
            school: 'HCMUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          a: {
            id: 'a',
            email: 'a@example.com',
            isActive: true,
            firstName: 'An',
            lastName: 'Tran',
            avatarUrl: '',
            bio: 'Builds backend APIs',
            location: 'Da Nang',
            jobTitle: 'Backend Engineer',
            company: 'Pixel Labs',
            school: 'DUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          b: {
            id: 'b',
            email: 'b@example.com',
            isActive: true,
            firstName: 'Bao',
            lastName: 'Le',
            avatarUrl: '',
            bio: 'Writes technical docs',
            location: 'Hue',
            jobTitle: 'Technical Writer',
            company: 'Studio Nine',
            school: 'Hue University',
            interests: ['Marketing'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        });
      }

      return Promise.resolve({
        a: { id: 'a', firstName: 'An', lastName: 'Tran', avatarUrl: '' },
        b: { id: 'b', firstName: 'Bao', lastName: 'Le', avatarUrl: '' },
        u1: { id: 'u1', firstName: 'Minh', lastName: 'Le', avatarUrl: '' },
        u2: { id: 'u2', firstName: 'Lan', lastName: 'Pham', avatarUrl: '' },
      });
    });
    getCommonGroupNames.mockResolvedValue({
      a: ['Backend Circle'],
      b: ['Docs Circle'],
    });

    const result = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 2 },
    });

    expect(result.data.map((candidate) => candidate.id)).toEqual(['a', 'b']);
    expect(getRecentInteractionScores).not.toHaveBeenCalled();
    expect(result.data[0]).toMatchObject({
      id: 'a',
      baseScore: 0.1,
      score: 0.1,
    });
    expect(result.data[1]).toMatchObject({
      id: 'b',
      baseScore: 0.1,
      score: 0.1,
    });
    expect(recordRecommendationEvents).toHaveBeenCalledWith([
      expect.objectContaining({
        candidateId: 'a',
        metadata: expect.objectContaining({
          baseScore: 0.1,
          score: 0.1,
          position: 0,
        }),
      }),
      expect.objectContaining({
        candidateId: 'b',
        metadata: expect.objectContaining({
          baseScore: 0.1,
          score: 0.1,
          position: 1,
        }),
      }),
    ]);
  });

  it('should surface profile-matched candidates when graph and group sources are empty', async () => {
    recommendFriends.mockResolvedValue({
      data: [],
      nextCursor: null,
      hasNextPage: false,
    });
    getGroupRecommendationCandidates.mockResolvedValue([]);
    getProfileRecommendationCandidates.mockResolvedValue([
      {
        id: 'p1',
        profileMatchScore: 0.8,
        matchedSignals: ['school', 'interests:2'],
        sharedInterestsCount: 2,
      },
      {
        id: 'p2',
        profileMatchScore: 0.4,
        matchedSignals: ['location'],
        sharedInterestsCount: 0,
      },
    ]);
    summarizeCandidates.mockImplementation(
      async (_userId: string, candidateIds: string[]) =>
        candidateIds.map((candidateId) => ({
          id: candidateId,
          mutualFriends: 0,
          mutualFriendIds: [],
        })),
    );
    getCommonGroupCounts.mockResolvedValue({
      p1: 0,
      p2: 0,
    });
    rerankCandidates.mockResolvedValue({});
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') => {
      if (projection === 'full') {
        return Promise.resolve({
          viewer: {
            id: 'viewer',
            email: 'viewer@example.com',
            isActive: true,
            firstName: 'Vinh',
            lastName: 'Co',
            avatarUrl: '',
            bio: 'Backend engineer who likes running',
            location: 'Ho Chi Minh City',
            jobTitle: 'Backend Engineer',
            company: 'Acme Social',
            school: 'HCMUT',
            interests: ['technology', 'running'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          p1: {
            id: 'p1',
            email: 'p1@example.com',
            isActive: true,
            firstName: 'Phuong',
            lastName: 'Tran',
            avatarUrl: '',
            bio: 'Builds backend systems and joins running clubs',
            location: 'Da Nang',
            jobTitle: 'Backend Engineer',
            company: 'Runner Labs',
            school: 'HCMUT',
            interests: ['technology', 'running'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          p2: {
            id: 'p2',
            email: 'p2@example.com',
            isActive: true,
            firstName: 'Trang',
            lastName: 'Le',
            avatarUrl: '',
            bio: 'Organizes city events',
            location: 'Ho Chi Minh City',
            jobTitle: 'Community Organizer',
            company: 'City Hub',
            school: 'UEH',
            interests: ['community'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        });
      }

      return Promise.resolve({
        p1: { id: 'p1', firstName: 'Phuong', lastName: 'Tran', avatarUrl: '' },
        p2: { id: 'p2', firstName: 'Trang', lastName: 'Le', avatarUrl: '' },
      });
    });
    getCommonGroupNames.mockResolvedValue({
      p1: [],
      p2: [],
    });

    const result = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 2 },
    });

    expect(result.data.map((candidate) => candidate.id)).toEqual(['p1', 'p2']);
    expect(result.data[0]).toMatchObject({
      id: 'p1',
      mutualFriends: 0,
      commonGroups: 0,
      baseScore: 0.12,
      score: 0.12,
      reasons: ['Similar profile: school, interests:2'],
    });
    expect(result.data[1]).toMatchObject({
      id: 'p2',
      baseScore: 0.06,
      score: 0.06,
      reasons: ['Similar profile: location'],
    });
  });

  it('should diversify repeated mutual-friend clusters in the integrated flow', async () => {
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
    getCommonGroupCounts.mockResolvedValue({
      a: 0,
      b: 0,
      c: 0,
    });
    rerankCandidates.mockResolvedValue({});
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') => {
      if (projection === 'full') {
        return Promise.resolve({
          viewer: {
            id: 'viewer',
            email: 'viewer@example.com',
            isActive: true,
            firstName: 'Vinh',
            lastName: 'Co',
            avatarUrl: '',
            bio: 'Backend engineer',
            location: 'Ho Chi Minh City',
            jobTitle: 'Backend Engineer',
            company: 'Acme Social',
            school: 'HCMUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          a: {
            id: 'a',
            email: 'a@example.com',
            isActive: true,
            firstName: 'An',
            lastName: 'Tran',
            avatarUrl: '',
            bio: 'Builds backend APIs',
            location: 'Da Nang',
            jobTitle: 'Backend Engineer',
            company: 'Pixel Labs',
            school: 'DUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          b: {
            id: 'b',
            email: 'b@example.com',
            isActive: true,
            firstName: 'Bao',
            lastName: 'Le',
            avatarUrl: '',
            bio: 'Works on data pipelines',
            location: 'Da Nang',
            jobTitle: 'Data Engineer',
            company: 'Data Hub',
            school: 'DUT',
            interests: ['Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
          c: {
            id: 'c',
            email: 'c@example.com',
            isActive: true,
            firstName: 'Chi',
            lastName: 'Nguyen',
            avatarUrl: '',
            bio: 'Builds frontend platforms',
            location: 'Hue',
            jobTitle: 'Frontend Engineer',
            company: 'Creative Hub',
            school: 'Hue University',
            interests: ['Thiết kế', 'Công nghệ'],
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
          },
        });
      }

      return Promise.resolve({
        a: { id: 'a', firstName: 'An', lastName: 'Tran', avatarUrl: '' },
        b: { id: 'b', firstName: 'Bao', lastName: 'Le', avatarUrl: '' },
        c: { id: 'c', firstName: 'Chi', lastName: 'Nguyen', avatarUrl: '' },
        u1: { id: 'u1', firstName: 'Minh', lastName: 'Le', avatarUrl: '' },
        u2: { id: 'u2', firstName: 'Lan', lastName: 'Pham', avatarUrl: '' },
      });
    });
    getCommonGroupNames.mockResolvedValue({
      a: ['Backend Circle'],
      b: ['Data Circle'],
      c: ['Frontend Circle'],
    });

    const result = await controller.recommendFriends({
      userId: 'viewer',
      query: { limit: 3 },
    });

    expect(result.data.map((candidate) => candidate.id)).toEqual(['a', 'c', 'b']);
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

  it('should rank a larger multi-user fixture predictably across graph, group, AI, and diversity signals', async () => {
    const fixture = buildMultiUserRecommendationFixture();
    const expectedOrder = [
      'semantic-peer',
      'community-host',
      'deep-graph',
      'runner-a',
      'group-designer',
      'mutual-docs',
      'mutual-local',
      'runner-b',
    ];

    recommendFriends.mockResolvedValue({
      data: fixture.graphCandidates,
      nextCursor: null,
      hasNextPage: false,
    });
    getGroupRecommendationCandidates.mockResolvedValue(fixture.groupCandidates);
    summarizeCandidates.mockResolvedValue(fixture.summarizedGroupCandidates);
    getCommonGroupCounts.mockResolvedValue(fixture.commonGroupCounts);
    getCommonGroupNames.mockResolvedValue(fixture.commonGroupNames);
    rerankCandidates.mockResolvedValue(fixture.aiScores);
    getUsers.mockImplementation((ids: string[], projection: 'base' | 'full') =>
      Promise.resolve(
        projection === 'full'
          ? resolveFixtureUsers(fixture.fullUsers, ids)
          : resolveFixtureUsers(fixture.baseUsers, ids),
      ),
    );

    const result = await controller.recommendFriends({
      userId: fixture.viewerId,
      query: { limit: expectedOrder.length },
    });

    expect(result.data.map((candidate) => candidate.id)).toEqual(expectedOrder);
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'semantic-peer',
          baseScore: 0.266667,
          modelScore: 0.9,
          score: 0.7166669999999999,
        }),
        expect.objectContaining({
          id: 'community-host',
          baseScore: 0.2,
          modelScore: 0.7,
          score: 0.55,
        }),
        expect.objectContaining({
          id: 'runner-a',
          baseScore: 0.166667,
          modelScore: 0.4,
          score: 0.366667,
        }),
      ]),
    );
    expect(recordRecommendationEvents).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          candidateId: 'semantic-peer',
          metadata: expect.objectContaining({
            source: 'mixed',
            position: 0,
            baseScore: 0.266667,
            modelScore: 0.9,
            score: 0.7166669999999999,
          }),
        }),
        expect.objectContaining({
          candidateId: 'community-host',
          metadata: expect.objectContaining({
            source: 'group_only',
            position: 1,
            baseScore: 0.2,
            modelScore: 0.7,
            score: 0.55,
          }),
        }),
        expect.objectContaining({
          candidateId: 'runner-a',
          metadata: expect.objectContaining({
            source: 'mixed',
            position: 3,
            baseScore: 0.166667,
            modelScore: 0.4,
            score: 0.366667,
          }),
        }),
      ]),
    );
  });
});
