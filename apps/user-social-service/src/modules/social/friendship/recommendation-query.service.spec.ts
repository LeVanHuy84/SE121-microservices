import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationClientService } from '../services/recommendation-client.service';
import { SOCIAL_GRAPH_REPOSITORY } from './repositories/social-graph.repository';
import { UserService } from '../../user/user.service';
import { RecommendationQueryService } from './recommendation/recommendation-query.service';

describe('RecommendationQueryService', () => {
  let service: RecommendationQueryService;

  const queryCandidates = jest.fn();
  const getBaseUsersBatch = jest.fn();
  const summarizeCandidates = jest.fn();
  const recordRecommendationEvents = jest.fn();

  beforeEach(async () => {
    queryCandidates.mockReset();
    getBaseUsersBatch.mockReset();
    summarizeCandidates.mockReset();
    recordRecommendationEvents.mockReset();

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
          provide: UserService,
          useValue: {
            getBaseUsersBatch,
          },
        },
        {
          provide: SOCIAL_GRAPH_REPOSITORY,
          useValue: {
            summarizeCandidates,
            recordRecommendationEvents,
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
    getBaseUsersBatch.mockResolvedValue({
      'candidate-1': { id: 'candidate-1', name: 'Alice' },
      'mutual-1': { id: 'mutual-1', name: 'Bob' },
      'mutual-2': { id: 'mutual-2', name: 'Charlie' },
    });
    recordRecommendationEvents.mockResolvedValue(undefined);

    const result = await service.recommendFriends('viewer-1', {
      limit: 10,
      cursor: undefined,
    });

    expect(queryCandidates).toHaveBeenCalledWith('viewer-1', 10, undefined);
    expect(summarizeCandidates).toHaveBeenCalledWith('viewer-1', [
      'candidate-1',
    ]);
    expect(getBaseUsersBatch).toHaveBeenCalledTimes(1);
    expect(recordRecommendationEvents).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: 'candidate-1',
          score: 0.7,
          modelScore: 0.6,
          retrievalScore: 0.8,
          mutualFriends: 2,
          mutualFriendIds: ['mutual-1', 'mutual-2'],
          commonGroups: 0,
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
    expect(getBaseUsersBatch).not.toHaveBeenCalled();
    expect(recordRecommendationEvents).not.toHaveBeenCalled();
  });
});
