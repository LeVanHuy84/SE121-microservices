import { Test, TestingModule } from '@nestjs/testing';
import { GroupClientService } from '../client/group/group-client.service';
import { FriendRecommendationService } from './friend-recommendation.service';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';

describe('FriendRecommendationService', () => {
  let service: FriendRecommendationService;
  const recommendFriends = jest.fn();
  const summarizeCandidates = jest.fn();
  const getCommonGroupCounts = jest.fn();
  const getGroupRecommendationCandidates = jest.fn();

  beforeEach(async () => {
    recommendFriends.mockReset();
    summarizeCandidates.mockReset();
    getCommonGroupCounts.mockReset();
    getGroupRecommendationCandidates.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FriendRecommendationService,
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            recommendFriends,
            summarizeCandidates,
          },
        },
        {
          provide: GroupClientService,
          useValue: {
            getCommonGroupCounts,
            getGroupRecommendationCandidates,
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
        commonGroups: 2,
        score: 22,
        reasons: ['1 mutual friend', '2 common groups'],
      },
      {
        id: 'b',
        mutualFriends: 1,
        mutualFriendIds: ['u2'],
        commonGroups: 0,
        score: 10,
        reasons: ['1 mutual friend'],
      },
    ]);
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
        commonGroups: 3,
        score: 18,
        reasons: ['3 common groups'],
      },
      {
        id: 'b',
        mutualFriends: 1,
        mutualFriendIds: ['u2'],
        commonGroups: 0,
        score: 10,
        reasons: ['1 mutual friend'],
      },
    ]);
  });
});
