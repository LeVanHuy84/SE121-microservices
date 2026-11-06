import { Test, TestingModule } from '@nestjs/testing';
import { IndexerService } from './indexer.service';
import { ELASTIC_CLIENT } from '../../../elastic/elastic.module';

describe('IndexerService', () => {
  let service: IndexerService;
  let mockEsClient: {
    bulk: jest.Mock;
  };

  beforeEach(async () => {
    mockEsClient = {
      bulk: jest.fn().mockResolvedValue({ errors: false, items: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerService,
        {
          provide: ELASTIC_CLIENT,
          useValue: mockEsClient,
        },
      ],
    }).compile();

    service = module.get<IndexerService>(IndexerService);
    // Mock sleep to resolve immediately during retry tests
    (service as any).sleep = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await service.onApplicationShutdown();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('TC-ES-01: Bulk Buffer Overflow', () => {
    it('should trigger flushIndex immediately when buffer reaches BULK_LIMIT (500)', async () => {
      const flushSpy = jest.spyOn(service, 'flushIndex');

      for (let i = 0; i < 499; i++) {
        service.addToBulk(
          'posts',
          { index: { _index: 'posts', _id: `post-${i}` } },
          { title: `Test ${i}` },
        );
      }
      expect(flushSpy).not.toHaveBeenCalled();

      // 500th action triggers flush
      service.addToBulk(
        'posts',
        { index: { _index: 'posts', _id: 'post-499' } },
        { title: 'Test 499' },
      );
      expect(flushSpy).toHaveBeenCalledWith('posts');
    });
  });

  describe('TC-ES-02: Flush Mixed Actions (Index, Update, Delete)', () => {
    it('should construct operations array correctly without offset mismatch', async () => {
      // 1: Index (meta + source)
      service.addToBulk(
        'posts',
        { index: { _index: 'posts', _id: 'p1' } },
        { content: 'hello' },
      );
      // 2: Delete (meta only)
      service.addToBulk('posts', { delete: { _index: 'posts', _id: 'p2' } });
      // 3: Update (meta + source)
      service.addToBulk(
        'posts',
        { update: { _index: 'posts', _id: 'p3' } },
        { doc: { content: 'updated' } },
      );

      mockEsClient.bulk.mockResolvedValueOnce({
        errors: false,
        items: [
          { index: { _id: 'p1', status: 201 } },
          { delete: { _id: 'p2', status: 200 } },
          { update: { _id: 'p3', status: 200 } },
        ],
      });

      await service.flushIndex('posts');

      expect(mockEsClient.bulk).toHaveBeenCalledTimes(1);
      expect(mockEsClient.bulk).toHaveBeenCalledWith({
        refresh: false,
        operations: [
          { index: { _index: 'posts', _id: 'p1' } },
          { content: 'hello' },
          { delete: { _index: 'posts', _id: 'p2' } },
          { update: { _index: 'posts', _id: 'p3' } },
          { doc: { content: 'updated' } },
        ],
      });
    });
  });

  describe('TC-ES-03: Partial Errors and Retry Flow', () => {
    it('should retry only failed operations with 1-to-1 mapping matching delete and index', async () => {
      // p1 = index, p2 = delete, p3 = update
      service.addToBulk(
        'posts',
        { index: { _index: 'posts', _id: 'p1' } },
        { content: 'p1' },
      );
      service.addToBulk('posts', { delete: { _index: 'posts', _id: 'p2' } });
      service.addToBulk(
        'posts',
        { update: { _index: 'posts', _id: 'p3' } },
        { doc: { content: 'p3' } },
      );

      // First call: p2 (delete) fails
      mockEsClient.bulk
        .mockResolvedValueOnce({
          errors: true,
          items: [
            { index: { _id: 'p1', status: 201 } },
            {
              delete: { _id: 'p2', status: 409, error: { reason: 'conflict' } },
            },
            { update: { _id: 'p3', status: 200 } },
          ],
        })
        // Second call (retry 1): success
        .mockResolvedValueOnce({
          errors: false,
          items: [{ delete: { _id: 'p2', status: 200 } }],
        });

      await service.flushIndex('posts');

      expect(mockEsClient.bulk).toHaveBeenCalledTimes(2);
      // Retry call should only contain p2 delete action!
      expect(mockEsClient.bulk).toHaveBeenNthCalledWith(2, {
        refresh: false,
        operations: [{ delete: { _index: 'posts', _id: 'p2' } }],
      });
    });

    it('should log permanent failure when retry attempts exceed 3', async () => {
      service.addToBulk(
        'posts',
        { index: { _index: 'posts', _id: 'p1' } },
        { content: 'p1' },
      );

      mockEsClient.bulk.mockResolvedValue({
        errors: true,
        items: [
          { index: { _id: 'p1', status: 500, error: { reason: 'es dead' } } },
        ],
      });

      await service.flushIndex('posts');

      // 1 initial + 3 retries = 4 calls total
      expect(mockEsClient.bulk).toHaveBeenCalledTimes(4);
    });
  });

  describe('Network / Catch block error retries', () => {
    it('should retry on unhandled exception in es.bulk call', async () => {
      service.addToBulk(
        'posts',
        { index: { _index: 'posts', _id: 'p1' } },
        { content: 'p1' },
      );

      mockEsClient.bulk
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({
          errors: false,
          items: [{ index: { _id: 'p1', status: 200 } }],
        });

      await service.flushIndex('posts');

      expect(mockEsClient.bulk).toHaveBeenCalledTimes(2);
    });

    it('should stop retrying if network error persists after 3 retries', async () => {
      service.addToBulk(
        'posts',
        { index: { _index: 'posts', _id: 'p1' } },
        { content: 'p1' },
      );

      mockEsClient.bulk.mockRejectedValue(new Error('Connection timeout'));

      await service.flushIndex('posts');

      expect(mockEsClient.bulk).toHaveBeenCalledTimes(4);
    });
  });

  describe('Concurrency & Lifecycle', () => {
    it('should prevent concurrent flushes of the same index', async () => {
      service.addToBulk(
        'users',
        { index: { _index: 'users', _id: 'u1' } },
        { name: 'Alice' },
      );

      let resolveBulk: any;
      mockEsClient.bulk.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveBulk = resolve;
          }),
      );

      const p1 = service.flushIndex('users');
      // Second flush called while first is in-flight
      const p2 = service.flushIndex('users');

      resolveBulk({ errors: false, items: [] });
      await p1;
      await p2;

      expect(mockEsClient.bulk).toHaveBeenCalledTimes(1);
    });

    it('should flush all indexes via flushAll()', async () => {
      service.addToBulk(
        'posts',
        { index: { _index: 'posts', _id: 'p1' } },
        { a: 1 },
      );
      service.addToBulk(
        'users',
        { index: { _index: 'users', _id: 'u1' } },
        { b: 2 },
      );

      await service.flushAll();

      expect(mockEsClient.bulk).toHaveBeenCalledTimes(2);
    });

    it('should flush all and clear timer on application shutdown', async () => {
      const flushAllSpy = jest.spyOn(service, 'flushAll').mockResolvedValue();

      await service.onApplicationShutdown();

      expect(flushAllSpy).toHaveBeenCalled();
    });
  });
});
