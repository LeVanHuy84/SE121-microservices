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

  it('should warn and skip rerank when recommendation config is missing', async () => {
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

    const result = await service.rerankCandidates('viewer-1', [
      {
        candidateId: 'candidate-1',
        mutualFriends: 1,
        commonGroups: 0,
        candidateProfileText: 'name: Candidate',
      },
    ]);

    expect(result).toEqual({});
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing config RECOMMENDATION_SERVICE_URL'),
    );
  });

  it('should log classified timeout failures and fall back to baseline', async () => {
    const error = Object.assign(new Error('timeout exceeded'), {
      isAxiosError: true,
      code: 'ECONNABORTED',
    });
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.post.mockRejectedValue(error);
    const errorSpy = jest.spyOn(service['logger'], 'error');

    const result = await service.rerankCandidates('viewer-1', [
      {
        candidateId: 'candidate-1',
        mutualFriends: 2,
        commonGroups: 1,
        candidateProfileText: 'name: Candidate',
      },
    ]);

    expect(result).toEqual({});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('reason=timeout'),
    );
  });

  it('should parse successful rerank responses', async () => {
    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.post.mockResolvedValue({
      data: {
        success: true,
        data: {
          scores: [
            {
              candidateId: 'candidate-1',
              modelScore: 0.82,
            },
          ],
        },
      },
    });

    const result = await service.rerankCandidates(
      'viewer-1',
      [
        {
          candidateId: 'candidate-1',
          mutualFriends: 2,
          commonGroups: 1,
          candidateProfileText: 'name: Candidate',
        },
      ],
      'name: Viewer',
    );

    expect(result).toEqual({
      'candidate-1': 0.82,
    });
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://127.0.0.1:4011/recommend/rerank',
      {
        viewerId: 'viewer-1',
        viewerProfileText: 'name: Viewer',
        candidates: [
          {
            candidateId: 'candidate-1',
            mutualFriends: 2,
            commonGroups: 1,
            candidateProfileText: 'name: Candidate',
          },
        ],
      },
      expect.objectContaining({
        headers: {
          'x-internal-key': 'internal-key',
        },
      }),
    );
  });

  it('should parse successful precomputed responses', async () => {
    mockedAxios.isAxiosError.mockReturnValue(false);
    mockedAxios.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          viewerId: 'viewer-1',
          generatedAt: '2026-04-10T10:00:00.000Z',
          generationReason: 'state-processor',
          modelName: 'demo-model',
          scoreVersion: 'retrieval-dot-product-v1',
          candidateCount: 1,
          candidates: [
            {
              candidateId: 'candidate-1',
              retrievalScore: 0.91,
              precomputeScore: 0.91,
              semanticScore: 0.91,
              rank: 1,
              generatedAt: '2026-04-10T10:00:00.000Z',
            },
          ],
        },
      },
    });

    const result = await service.getPrecomputedCandidates('viewer-1', 5);

    expect(result).toEqual({
      viewerId: 'viewer-1',
      generatedAt: '2026-04-10T10:00:00.000Z',
      generationReason: 'state-processor',
      modelName: 'demo-model',
      scoreVersion: 'retrieval-dot-product-v1',
      candidateCount: 1,
      candidates: [
        {
          candidateId: 'candidate-1',
          retrievalScore: 0.91,
          precomputeScore: 0.91,
          semanticScore: 0.91,
          rank: 1,
          generatedAt: '2026-04-10T10:00:00.000Z',
        },
      ],
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://127.0.0.1:4011/recommend/precomputed/viewer-1',
      expect.objectContaining({
        headers: {
          'x-internal-key': 'internal-key',
        },
        params: {
          limit: 5,
        },
      }),
    );
  });
});
