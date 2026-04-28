import { Test, TestingModule } from '@nestjs/testing';
import { GroupClientService } from '../client/group/group-client.service';
import { RecommendationClientService } from '../client/recommendation/recommendation-client.service';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';
import { RecommendationHydrationService } from './recommendation/recommendation-hydration.service';
import { RecommendationQueryService } from './recommendation/recommendation-query.service';
import { RecommendationTrackingService } from './recommendation/recommendation-tracking.service';

describe('RecommendationQueryService', () => {
  let service: RecommendationQueryService;

  const queryCandidates = jest.fn();
  const hydrateRecommendationUsers = jest.fn();
  const attachRecommendationTrackingIds = jest.fn();
  const recordServedEvents = jest.fn();
  const summarizeCandidates = jest.fn();
  const getCommonGroupCounts = jest.fn();

  beforeEach(async () => {
    queryCandidates.mockReset();
    hydrateRecommendationUsers.mockReset();
    attachRecommendationTrackingIds.mockReset();
    recordServedEvents.mockReset();
    summarizeCandidates.mockReset();
    getCommonGroupCounts.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationQueryService,
        {
          provide: RecommendationClientService,
          useValue: {
            queryCandidates,
          },
        },
        {
          provide: RecommendationHydrationService,
          useValue: {
            hydrateRecommendationUsers,
          },
        },
        {
          provide: RecommendationTrackingService,
          useValue: {
            attachRecommendationTrackingIds,
            recordServedEvents,
          },
        },
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            summarizeCandidates,
          },
        },
        {
          provide: GroupClientService,
          useValue: {
            getCommonGroupCounts,
          },
        },
      ],
    }).compile();

    service = module.get<RecommendationQueryService>(
      RecommendationQueryService,
    );
  });

  it('should delegate recommendation query to recommendation-service and hydrate/tracking response', async () => {
    queryCandidates.mockResolvedValue({
      viewerId: 'viewer-1',
      generatedAt: '2026-04-13T10:00:00.000Z',
      source: 'semantic_online',
      scoreVersion: 'recommendation-query-pipeline-v1',
      candidateCount: 1,
      nextCursor: 'next-cursor',
      hasNextPage: true,
      candidates: [
        {
          candidateId: 'candidate-1',
          source: 'semantic_online',
          retrievalScore: 0.8,
          modelScore: 0.6,
          finalScore: 0.7,
          mutualFriendCount: 1,
          commonGroupCount: 0,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['semantic_retrieval', 'semantic_rerank'],
          rank: 1,
        },
      ],
    });
    summarizeCandidates.mockResolvedValue([
      {
        id: 'candidate-1',
        mutualFriends: 2,
        mutualFriendIds: ['mutual-1', 'mutual-2'],
      },
    ]);
    getCommonGroupCounts.mockResolvedValue({
      'candidate-1': 3,
    });
    attachRecommendationTrackingIds.mockImplementation((rows) => rows);
    hydrateRecommendationUsers.mockImplementation(async (rows) => rows);
    recordServedEvents.mockResolvedValue(undefined);

    const result = await service.recommendFriends('viewer-1', {
      limit: 10,
      cursor: undefined,
    });

    expect(queryCandidates).toHaveBeenCalledWith('viewer-1', 10, undefined);
    expect(summarizeCandidates).toHaveBeenCalledWith('viewer-1', [
      'candidate-1',
    ]);
    expect(getCommonGroupCounts).toHaveBeenCalledWith('viewer-1', [
      'candidate-1',
    ]);
    expect(attachRecommendationTrackingIds).toHaveBeenCalledTimes(1);
    expect(hydrateRecommendationUsers).toHaveBeenCalledTimes(1);
    expect(recordServedEvents).toHaveBeenCalledWith(
      'viewer-1',
      expect.any(Array),
      0,
    );
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: 'candidate-1',
          score: 0.7,
          modelScore: 0.6,
          retrievalScore: 0.8,
          mutualFriends: 2,
          mutualFriendIds: ['mutual-1', 'mutual-2'],
          commonGroups: 3,
          candidateSourceMode: 'online',
        }),
      ],
      nextCursor: 'next-cursor',
      hasNextPage: true,
    });
  });

  it('should return empty page when recommendation-service query fails', async () => {
    queryCandidates.mockResolvedValue(null);

    const result = await service.recommendFriends('viewer-1', {
      limit: 10,
      cursor: undefined,
    });

    expect(result).toEqual({
      data: [],
      nextCursor: null,
      hasNextPage: false,
    });
    expect(hydrateRecommendationUsers).not.toHaveBeenCalled();
    expect(recordServedEvents).not.toHaveBeenCalled();
  });
});
