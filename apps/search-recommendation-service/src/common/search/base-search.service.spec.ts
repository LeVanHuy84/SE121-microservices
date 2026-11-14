import { Test, TestingModule } from '@nestjs/testing';
import { BaseSearchService } from './base-search.service';
import { ELASTIC_CLIENT } from '../../elastic/elastic.module';

class TestSearchService extends BaseSearchService {
  indexName = 'test-index';
}

describe('BaseSearchService', () => {
  let service: TestSearchService;
  let mockEsClient: {
    search: jest.Mock;
  };

  beforeEach(async () => {
    mockEsClient = {
      search: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestSearchService,
        {
          provide: ELASTIC_CLIENT,
          useValue: mockEsClient,
        },
      ],
    }).compile();

    service = module.get<TestSearchService>(TestSearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.indexName).toBe('test-index');
  });

  describe('defaultSort', () => {
    it('should return default sort by createdAt desc and id asc', () => {
      const sort = service.defaultSort();
      expect(sort).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    });
  });

  describe('textSearch', () => {
    it('should build multi_match query and execute search', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { id: '1', title: 'Test 1' }, sort: [100, '1'] },
            { _source: { id: '2', title: 'Test 2' }, sort: [90, '2'] },
          ],
        },
      });

      const result = await service.textSearch(
        'hello',
        ['title', 'content'],
        undefined,
        2,
      );

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'test-index',
          size: 2,
          query: {
            multi_match: {
              query: 'hello',
              fields: ['title', 'content'],
            },
          },
          sort: [{ createdAt: 'desc' }, { id: 'asc' }],
        }),
      );

      expect(result.data).toHaveLength(2);
      expect(result.hasNextPage).toBe(true);
      expect(result.nextCursor).toBe(
        Buffer.from(JSON.stringify([90, '2'])).toString('base64'),
      );
    });

    it('should handle custom sort and cursor', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: {
          hits: [{ _source: { id: '3' }, sort: [80, '3'] }],
        },
      });

      const cursor = Buffer.from(JSON.stringify([90, '2'])).toString('base64');
      const customSort = [{ score: 'desc' }];
      const result = await service.textSearch(
        'hello',
        ['title'],
        cursor,
        10,
        customSort,
      );

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          search_after: [90, '2'],
          sort: customSort,
          size: 10,
        }),
      );
      expect(result.hasNextPage).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('boolSearch', () => {
    it('should build bool query and execute search', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: {
          hits: [{ _source: { id: '10' } }],
        },
      });

      const boolQuery = { must: [{ term: { active: true } }] };
      const result = await service.boolSearch(boolQuery, undefined, 5);

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 'test-index',
          query: { bool: boolQuery },
          size: 5,
        }),
      );
      expect(result.data).toEqual([{ id: '10' }]);
      expect(result.hasNextPage).toBe(false);
    });
  });

  describe('highlightSearch', () => {
    it('should attach highlight fields to mapped hits', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: {
          hits: [
            {
              _source: { id: '1', content: 'hello world' },
              highlight: { content: ['<em>hello</em> world'] },
              sort: [1, '1'],
            },
          ],
        },
      });

      const result = await service.highlightSearch(
        'hello',
        ['content'],
        undefined,
        1,
      );

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          highlight: { content: {} },
        }),
      );
      expect(result.data[0]).toEqual({
        id: '1',
        content: 'hello world',
        highlight: { content: ['<em>hello</em> world'] },
      });
    });
  });

  describe('TC-ES-04 & TC-ES-05: Cursor Safety and Decoding', () => {
    it('TC-ES-04: should decode valid base64 JSON cursor properly', async () => {
      mockEsClient.search.mockResolvedValueOnce({ hits: { hits: [] } });

      const validCursor = Buffer.from(
        JSON.stringify([123456, 'doc-id-1']),
      ).toString('base64');
      await service.boolSearch({}, validCursor, 10);

      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          search_after: [123456, 'doc-id-1'],
        }),
      );
    });

    it('TC-ES-05: should safely ignore malformed base64 cursor without throwing', async () => {
      mockEsClient.search.mockResolvedValueOnce({ hits: { hits: [] } });

      const malformedCursor = 'not-a-valid-base64-json-***';
      const result = await service.boolSearch({}, malformedCursor, 10);

      expect(result.data).toEqual([]);
      expect(mockEsClient.search).toHaveBeenCalledWith(
        expect.not.objectContaining({
          search_after: expect.anything(),
        }),
      );
    });

    it('should return null nextCursor if hits is empty or less than size', async () => {
      mockEsClient.search.mockResolvedValueOnce({
        hits: { hits: [] },
      });

      const result = await service.boolSearch({}, undefined, 10);
      expect(result.nextCursor).toBeNull();
      expect(result.hasNextPage).toBe(false);
    });
  });
});
