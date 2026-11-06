import { QueryCacheService } from './query-cache.service';

describe('QueryCacheService', () => {
  let service: QueryCacheService;
  let mockRedis: {
    get: jest.Mock;
    hincrby: jest.Mock;
    zrem: jest.Mock;
    zadd: jest.Mock;
    zcard: jest.Mock;
    zrange: jest.Mock;
    pipeline: jest.Mock;
    smembers: jest.Mock;
  };
  let mockPipeline: {
    set: jest.Mock;
    sadd: jest.Mock;
    pexpire: jest.Mock;
    zadd: jest.Mock;
    zrem: jest.Mock;
    del: jest.Mock;
    hincrby: jest.Mock;
    exec: jest.Mock;
  };

  beforeEach(() => {
    mockPipeline = {
      set: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      pexpire: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      zrem: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      hincrby: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    mockRedis = {
      get: jest.fn(),
      hincrby: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      zadd: jest.fn().mockResolvedValue(1),
      zcard: jest.fn().mockResolvedValue(0),
      zrange: jest.fn().mockResolvedValue([]),
      pipeline: jest.fn().mockReturnValue(mockPipeline),
      smembers: jest.fn().mockResolvedValue([]),
    };

    service = new QueryCacheService(mockRedis as any);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('get', () => {
    it('should return null and record cache miss when key is not in redis', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const res = await service.get({ viewerId: 'user-1' });

      expect(res).toBeNull();
      expect(mockRedis.hincrby).toHaveBeenCalledWith(
        expect.stringContaining(':stats'),
        'misses',
        1,
      );
      expect(mockRedis.zrem).toHaveBeenCalled();
    });

    it('should return cached data, update LRU score and increment hits', async () => {
      const cached = {
        viewerId: 'user-1',
        candidates: [{ candidateId: 'c1' }],
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

      const res = await service.get({ viewerId: 'user-1' });

      expect(res).toEqual(cached);
      expect(mockRedis.hincrby).toHaveBeenCalledWith(
        expect.stringContaining(':stats'),
        'hits',
        1,
      );
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        expect.stringContaining(':index'),
        expect.any(Number),
        expect.any(String),
      );
    });
  });

  describe('set & TC-REC-08: LRU Eviction', () => {
    it('should store entry and execute pipeline', async () => {
      const output = { candidates: [{ candidateId: 'c1' }] };
      await service.set({ viewerId: 'user-1' }, output);

      expect(mockPipeline.set).toHaveBeenCalled();
      expect(mockPipeline.sadd).toHaveBeenCalled();
      expect(mockPipeline.zadd).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('TC-REC-08: should trigger LRU eviction when index count exceeds maxEntries', async () => {
      (service as any).maxEntries = 2;
      mockRedis.zcard.mockResolvedValueOnce(5); // 5 - 2 = 3 overflow
      mockRedis.zrange.mockResolvedValueOnce([
        'old-key-1',
        'old-key-2',
        'old-key-3',
      ]);

      await service.set({ viewerId: 'user-1' }, { data: [] });

      expect(mockRedis.zrange).toHaveBeenCalledWith(
        expect.stringContaining(':index'),
        0,
        2, // overflow - 1
      );
      expect(mockPipeline.del).toHaveBeenCalledWith('old-key-1');
      expect(mockPipeline.del).toHaveBeenCalledWith('old-key-2');
      expect(mockPipeline.del).toHaveBeenCalledWith('old-key-3');
    });
  });

  describe('invalidateViewer & invalidateMany', () => {
    it('should delete all keys associated with a viewer', async () => {
      mockRedis.smembers.mockResolvedValueOnce(['cache-key-1', 'cache-key-2']);

      await service.invalidateViewer('user-1');

      expect(mockPipeline.del).toHaveBeenCalledWith('cache-key-1');
      expect(mockPipeline.del).toHaveBeenCalledWith('cache-key-2');
      expect(mockPipeline.hincrby).toHaveBeenCalledWith(
        expect.stringContaining(':stats'),
        'invalidations',
        1,
      );
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('should invalidate multiple viewers in parallel', async () => {
      const spy = jest
        .spyOn(service, 'invalidateViewer')
        .mockResolvedValue(undefined);
      await service.invalidateMany(['user-1', 'user-2']);

      expect(spy).toHaveBeenCalledWith('user-1');
      expect(spy).toHaveBeenCalledWith('user-2');
    });
  });

  describe('Candidate Session Storage', () => {
    it('should store candidate session and return generated sessionId', async () => {
      const candidates = [{ candidateId: 'c1', score: 0.9 }];
      const sessionId = await service.storeCandidateSession(
        'user-1',
        'semantic_online',
        'v1',
        candidates,
      );

      expect(sessionId).toBeTruthy();
      expect(mockPipeline.set).toHaveBeenCalledWith(
        expect.stringContaining(':session:'),
        expect.any(String),
        'PX',
        expect.any(Number),
      );
    });

    it('should retrieve candidate session when exists', async () => {
      const payload = {
        viewerId: 'user-1',
        candidates: [{ candidateId: 'c1' }],
      };
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(payload));

      const res = await service.getCandidateSession('valid-session-id');

      expect(res).toEqual(payload);
      expect(mockRedis.hincrby).toHaveBeenCalledWith(
        expect.stringContaining(':stats'),
        'sessionHits',
        1,
      );
    });

    it('should return null and increment sessionMisses when session not found', async () => {
      mockRedis.get.mockResolvedValueOnce(null);

      const res = await service.getCandidateSession('expired-session-id');

      expect(res).toBeNull();
      expect(mockRedis.hincrby).toHaveBeenCalledWith(
        expect.stringContaining(':stats'),
        'sessionMisses',
        1,
      );
    });
  });
});
