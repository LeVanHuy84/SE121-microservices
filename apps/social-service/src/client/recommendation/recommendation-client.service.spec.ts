import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RecommendationClientService } from './recommendation-client.service';

jest.mock('axios');

describe('RecommendationClientService', () => {
  let service: RecommendationClientService;
  let configService: { get: jest.Mock };

  const mockedAxios = jest.mocked(axios);

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        switch (key) {
          case 'RECOMMENDATION_SERVICE_URL':
            return 'http://127.0.0.1:4011';
          case 'RECOMMENDATION_INTERNAL_KEY':
            return 'internal-key';
          case 'RECOMMENDATION_SERVICE_TIMEOUT_MS':
            return defaultValue ?? 2000;
          default:
            return defaultValue;
        }
      }),
    };

    service = new RecommendationClientService(
      configService as unknown as ConfigService,
    );
  });

  it('should warn and skip query when recommendation config is missing', async () => {
    configService.get.mockImplementation(
      (key: string, defaultValue?: unknown) => {
        switch (key) {
          case 'RECOMMENDATION_SERVICE_URL':
            return undefined;
          case 'RECOMMENDATION_INTERNAL_KEY':
            return 'internal-key';
          case 'RECOMMENDATION_SERVICE_TIMEOUT_MS':
            return defaultValue ?? 2000;
          default:
            return defaultValue;
        }
      },
    );
    const warnSpy = jest.spyOn(service['logger'], 'warn');

    const result = await service.queryCandidates('viewer-1', 10, null);

    expect(result).toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing config RECOMMENDATION_SERVICE_URL'),
    );
  });

  it('should log classified timeout failures and return null', async () => {
    const error = Object.assign(new Error('timeout exceeded'), {
      isAxiosError: true,
      code: 'ECONNABORTED',
    });
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue(error);
    const errorSpy = jest.spyOn(service['logger'], 'error');

    const result = await service.queryCandidates('viewer-1', 10, null);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=timeout'),
    );
  });

  it('should parse successful query responses', async () => {
    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockResolvedValue({
      data: {
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
      },
    });

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
          scoreVersion: 'recommendation-query-pipeline-v1',
          reasonCodes: ['semantic_retrieval'],
          rank: 1,
        },
      ],
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://127.0.0.1:4011/recommend/query',
      {
        viewerId: 'viewer-1',
        limit: 10,
        cursor: undefined,
      },
      expect.objectContaining({
        headers: {
          'x-internal-key': 'internal-key',
        },
      }),
    );
  });
});
