import { FlushScheduler } from './flush.scheduler';

describe('FlushScheduler', () => {
  let scheduler: FlushScheduler;
  let mockIndexer: {
    flushAll: jest.Mock;
  };

  beforeEach(() => {
    mockIndexer = {
      flushAll: jest.fn().mockResolvedValue(undefined),
    };
    scheduler = new FlushScheduler(mockIndexer as any);
  });

  it('should be defined', () => {
    expect(scheduler).toBeDefined();
  });

  it('should call indexer.flushAll() on autoFlush', async () => {
    await scheduler.autoFlush();
    expect(mockIndexer.flushAll).toHaveBeenCalled();
  });
});
