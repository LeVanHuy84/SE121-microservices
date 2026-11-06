import { RedisPubSubService } from './redis.service';
import type Redis from 'ioredis';
import { EventEmitter } from 'events';

describe('RedisPubSubService (Suite 5)', () => {
  let service: RedisPubSubService;
  let mockBaseClient: any;
  let mockPubClient: any;
  let mockSubClient: any;

  beforeEach(() => {
    // sub client needs EventEmitter for 'message' and 'pmessage'
    mockSubClient = Object.assign(new EventEmitter(), {
      subscribe: jest.fn().mockResolvedValue(1),
      unsubscribe: jest.fn().mockResolvedValue(1),
      psubscribe: jest.fn().mockResolvedValue(1),
      punsubscribe: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
    });

    mockPubClient = {
      publish: jest.fn().mockResolvedValue(1),
      config: jest.fn().mockResolvedValue('OK'),
      quit: jest.fn().mockResolvedValue('OK'),
    };

    let duplicateCallCount = 0;
    mockBaseClient = {
      duplicate: jest.fn().mockImplementation(() => {
        duplicateCallCount++;
        return duplicateCallCount === 1 ? mockPubClient : mockSubClient;
      }),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      exists: jest.fn(),
      ttl: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      keys: jest.fn(),
      expire: jest.fn(),
      sadd: jest.fn(),
      srem: jest.fn(),
      smembers: jest.fn(),
      scard: jest.fn(),
      hset: jest.fn().mockResolvedValue(1),
      hget: jest.fn(),
      hdel: jest.fn().mockResolvedValue(1),
      pipeline: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
      scanStream: jest.fn(),
    };

    service = new RedisPubSubService(mockBaseClient as unknown as Redis);
  });

  describe('Data Operations (TC-COM-15)', () => {
    it('TC-COM-15: should set JSON value with TTL and retrieve/parse it on get', async () => {
      const key = 'user:1';
      const user = { id: 1, name: 'An' };

      // Test set with TTL
      await service.set(key, user, 60);
      expect(mockBaseClient.set).toHaveBeenCalledWith(
        key,
        JSON.stringify(user),
        'EX',
        60,
      );

      // Test get with JSON
      mockBaseClient.get.mockResolvedValueOnce(JSON.stringify(user));
      const retrieved = await service.get<typeof user>(key);
      expect(retrieved).toEqual(user);

      // Test get when key does not exist (returns null)
      mockBaseClient.get.mockResolvedValueOnce(null);
      const notFound = await service.get(key);
      expect(notFound).toBeNull();

      // Test get when value is plain string (not JSON)
      mockBaseClient.get.mockResolvedValueOnce('plain-string');
      const plain = await service.get(key);
      expect(plain).toBe('plain-string');
    });

    it('should set value without TTL when ttlSeconds is not passed', async () => {
      await service.set('token', 'abc-123');
      expect(mockBaseClient.set).toHaveBeenCalledWith('token', 'abc-123');
    });

    it('should check existence, ttl, expire, del and keys', async () => {
      mockBaseClient.exists.mockResolvedValueOnce(1);
      expect(await service.exists('test-key')).toBe(true);

      mockBaseClient.exists.mockResolvedValueOnce(0);
      expect(await service.exists('nonexistent')).toBe(false);

      mockBaseClient.ttl.mockResolvedValueOnce(120);
      expect(await service.ttl('test-key')).toBe(120);

      mockBaseClient.expire.mockResolvedValueOnce(1);
      await service.expire('test-key', 60);
      expect(mockBaseClient.expire).toHaveBeenCalledWith('test-key', 60);

      await service.del('k1', 'k2');
      expect(mockBaseClient.del).toHaveBeenCalledWith('k1', 'k2');

      mockBaseClient.keys.mockResolvedValueOnce(['k1', 'k2']);
      expect(await service.keys('k*')).toEqual(['k1', 'k2']);
    });

    it('should handle set operations: sadd, srem, smembers, scard', async () => {
      mockBaseClient.sadd.mockResolvedValueOnce(1);
      await service.sadd('myset', 'v1', 'v2');
      expect(mockBaseClient.sadd).toHaveBeenCalledWith('myset', 'v1', 'v2');

      mockBaseClient.srem.mockResolvedValueOnce(1);
      await service.srem('myset', 'v1');
      expect(mockBaseClient.srem).toHaveBeenCalledWith('myset', 'v1');

      mockBaseClient.smembers.mockResolvedValueOnce(['v2']);
      expect(await service.smembers('myset')).toEqual(['v2']);

      mockBaseClient.scard.mockResolvedValueOnce(1);
      expect(await service.scard('myset')).toBe(1);
    });

    it('should handle hash operations: hset, hget, hdel', async () => {
      // Case 0: empty object map
      const emptyResult = await service.hset('user:hash', {});
      expect(emptyResult).toBe(0);

      // Case 1: object map
      await service.hset('user:hash', { name: 'An', age: 25 });
      expect(mockBaseClient.hset).toHaveBeenCalledWith(
        'user:hash',
        'name',
        'An',
        'age',
        '25',
      );

      // Case 2: field and single value
      await service.hset('user:hash', 'role', 'admin');
      expect(mockBaseClient.hset).toHaveBeenCalledWith(
        'user:hash',
        'role',
        'admin',
      );

      // Case 3: multiple pairs
      await service.hset('user:hash', 'f1', 'v1', 'f2', 'v2');
      expect(mockBaseClient.hset).toHaveBeenCalledWith(
        'user:hash',
        'f1',
        'v1',
        'f2',
        'v2',
      );

      // Case 4: incomplete pairs (odd rest)
      await service.hset('user:hash', 'f1', 'v1', 'f2');
      expect(mockBaseClient.hset).toHaveBeenCalledWith(
        'user:hash',
        'f1',
        'v1',
      );

      // Hget and Hdel
      mockBaseClient.hget.mockResolvedValueOnce('An');
      expect(await service.hget('user:hash', 'name')).toBe('An');

      await service.hdel('user:hash', 'name');
      expect(mockBaseClient.hdel).toHaveBeenCalledWith('user:hash', 'name');
    });

    it('should throw error when hset is called with a single field string and no value', async () => {
      await expect(service.hset('key', 'only-field')).rejects.toThrow(
        'hset requires value when first arg is field name',
      );
    });
  });

  describe('Pub/Sub Operations (TC-COM-16)', () => {
    it('TC-COM-16: should dispatch message to subscribed handlers upon receiving redis message', async () => {
      const channel = 'channel:post';
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      // Subscribe handler 1
      await service.subscribe(channel, handler1);
      expect(mockSubClient.subscribe).toHaveBeenCalledWith(channel);

      // Subscribe handler 2 to the same channel (should not call redis sub again)
      await service.subscribe(channel, handler2);
      expect(mockSubClient.subscribe).toHaveBeenCalledTimes(1);

      // Simulate Redis pubsub event
      const payload = JSON.stringify({ postId: 'p-1', title: 'New Post' });
      mockSubClient.emit('message', channel, payload);

      expect(handler1).toHaveBeenCalledWith(payload, channel);
      expect(handler2).toHaveBeenCalledWith(payload, channel);

      // Test unsubscribe
      await service.unsubscribe(channel);
      expect(mockSubClient.unsubscribe).toHaveBeenCalledWith(channel);

      // After unsubscribe, handler should not be called
      mockSubClient.emit('message', channel, payload);
      expect(handler1).toHaveBeenCalledTimes(1);
    });

    it('should support pattern subscribe (psubscribe) and pattern unsubscribe', async () => {
      const pattern = 'events:*';
      const pHandler = jest.fn();

      await service.psubscribe(pattern, pHandler);
      expect(mockSubClient.psubscribe).toHaveBeenCalledWith(pattern);

      mockSubClient.emit('pmessage', pattern, 'events:user', 'user_created');
      expect(pHandler).toHaveBeenCalledWith(
        pattern,
        'events:user',
        'user_created',
      );

      await service.punsubscribe(pattern);
      expect(mockSubClient.punsubscribe).toHaveBeenCalledWith(pattern);
    });

    it('should publish string and serialized object correctly', async () => {
      await service.publish('test-ch', 'plain message');
      expect(mockPubClient.publish).toHaveBeenCalledWith(
        'test-ch',
        'plain message',
      );

      const obj = { alert: true };
      await service.publish('test-ch', obj);
      expect(mockPubClient.publish).toHaveBeenCalledWith(
        'test-ch',
        JSON.stringify(obj),
      );
    });
  });

  describe('Utilities', () => {
    it('should support pipeline, scanStream, and duplicate client', () => {
      service.pipeline();
      expect(mockBaseClient.pipeline).toHaveBeenCalled();

      service.scanStream('pattern:*', 50);
      expect(mockBaseClient.scanStream).toHaveBeenCalledWith({
        match: 'pattern:*',
        count: 50,
      });

      service.duplicate();
      expect(mockBaseClient.duplicate).toHaveBeenCalled();
    });

    it('should flush keys by prefix', async () => {
      mockBaseClient.keys.mockResolvedValueOnce(['cache:1', 'cache:2']);
      await service.flushByPrefix('cache');

      expect(mockBaseClient.keys).toHaveBeenCalledWith('cache:*');
      expect(mockBaseClient.del).toHaveBeenCalledWith('cache:1', 'cache:2');
    });

    it('should enable keyspace events and quit connections gracefully', async () => {
      await service.enableKeyspaceEvents();
      expect(mockPubClient.config).toHaveBeenCalledWith(
        'SET',
        'notify-keyspace-events',
        'Ex',
      );

      await service.quitAll();
      expect(mockPubClient.quit).toHaveBeenCalled();
      expect(mockSubClient.quit).toHaveBeenCalled();
      expect(mockBaseClient.quit).toHaveBeenCalled();
    });
  });
});
