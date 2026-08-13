import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { RecommendationClientService } from './recommendation-client.service';
import { ClientProxy } from '@nestjs/microservices';

describe('RecommendationClientService', () => {
  let service: RecommendationClientService;
  let configService: { get: jest.Mock };
  let mockClientProxy: { send: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        switch (key) {
          case 'SEARCH_RECOMMENDATION_SERVICE_PORT':
            return 4009;
          default:
            return defaultValue;
        }
      }),
    };

    mockClientProxy = {
      send: jest.fn(),
    };

    service = new RecommendationClientService(
      configService as unknown as ConfigService,
    );
    Object.defineProperty(service, 'client', {
      value: mockClientProxy,
      writable: true,
    });
  });

  it('should return null when viewerId is empty', async () => {
    const result = await service.queryCandidates('', 10, null);
    expect(result).toBeNull();
    expect(mockClientProxy.send).not.toHaveBeenCalled();
  });

  it('should log failures and return null when client send fails', async () => {
    mockClientProxy.send.mockReturnValue(throwError(() => new Error('Connection failed')));
    const errorSpy = jest.spyOn(service['logger'], 'error');

    const result = await service.queryCandidates('viewer-1', 10, null);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=Connection failed'),
    );
  });

  it('should parse successful query responses', async () => {
    mockClientProxy.send.mockReturnValue(of({
      success: true,
      data: {
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
            retrievalScore: 0.81,
            modelScore: 0.62,
            finalScore: 0.7,
            scoreVersion: 'recommendation-query-pipeline-v1',
            reasonCodes: ['semantic_retrieval'],
            rank: 1,
          },
        ],
      },
    }));

    const result = await service.queryCandidates('viewer-1', 10, null);

    expect(result).toEqual({
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
          retrievalScore: 0.81,
          modelScore: 0.62,
          finalScore: 0.7,
          mutualFriendCount: 0,
          commonGroupCount: 0,
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['semantic_retrieval'],
          rank: 1,
        },
      ],
    });
    expect(mockClientProxy.send).toHaveBeenCalledWith(
      'query_recommendation_candidates',
      {
        viewerId: 'viewer-1',
        limit: 10,
        cursor: undefined,
      },
    );
  });
});
