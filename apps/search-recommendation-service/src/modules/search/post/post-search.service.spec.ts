import { Test, TestingModule } from '@nestjs/testing';
import { PostSearchService } from './post-search.service';
import { ELASTIC_CLIENT } from '../../../elastic/elastic.module';
import { Emotion, SearchPostDto, SortOrder } from '@repo/dtos';

describe('PostSearchService', () => {
  let service: PostSearchService;
  let mockEsClient: {
    search: jest.Mock;
  };

  beforeEach(async () => {
    mockEsClient = {
      search: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostSearchService,
        {
          provide: ELASTIC_CLIENT,
          useValue: mockEsClient,
        },
      ],
    }).compile();

    service = module.get<PostSearchService>(PostSearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('posts');
  });

  describe('TC-ES-06: searchPosts with filters and emotions', () => {
    it('should search posts with query, userId, groupId, and mainEmotion JOY filter', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _source: { id: 'post-1', content: 'Happy day' },
              sort: [100, 'post-1'],
            },
          ],
        },
      });

      const dto: SearchPostDto = {
        query: 'happy',
        userId: 'user-1',
        groupId: 'group-1',
        emotion: Emotion.JOY,
        sortBy: 'createdAt',
        order: SortOrder.DESC,
        limit: 10,
      };

      const result = await service.searchPosts(dto);

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'posts',
          size: 10,
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: 'happy',
                    fields: ['content'],
                  },
                },
              ],
              filter: [
                { term: { userId: 'user-1' } },
                { term: { groupId: 'group-1' } },
                { term: { mainEmotion: Emotion.JOY } },
              ],
            },
          },
          sort: [{ createdAt: 'desc' }, { id: 'asc' }],
        }),
      );

      expect(result.postIds).toEqual(['post-1']);
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('should handle search with ASC sort order and cursor', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _source: { id: 'post-2', content: 'Second' },
              sort: [200, 'post-2'],
            },
          ],
        },
      });

      const cursor = Buffer.from(JSON.stringify([100, 'post-1'])).toString(
        'base64',
      );
      const dto: SearchPostDto = {
        query: '',
        sortBy: 'createdAt',
        order: SortOrder.ASC,
        limit: 1,
        cursor,
      };

      const result = await service.searchPosts(dto);

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          search_after: [100, 'post-1'],
          sort: [{ createdAt: 'asc' }, { id: 'asc' }],
          size: 1,
        }),
      );
      expect(result.postIds).toEqual(['post-2']);
      expect(result.hasNextPage).toBe(true);
      expect(result.nextCursor).toBe(
        Buffer.from(JSON.stringify([200, 'post-2'])).toString('base64'),
      );
    });
  });
});
