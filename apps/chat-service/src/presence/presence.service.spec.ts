import { PresenceService } from './presence.service';

describe('PresenceService', () => {
  const createPipeline = () => {
    const pipeline = {
      hmset: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };

    return pipeline;
  };

  const redis = {
    duplicate: jest.fn(),
    hget: jest.fn(),
    pipeline: jest.fn(),
    eval: jest.fn(),
    publish: jest.fn(),
  };

  const createService = () => new PresenceService(redis as any);

  beforeEach(() => {
    jest.clearAllMocks();
    redis.publish.mockResolvedValue(1);
  });

  it('publishes an online update when a heartbeat arrives for an offline user', async () => {
    const pipeline = createPipeline();
    redis.hget.mockResolvedValue('offline');
    redis.pipeline.mockReturnValue(pipeline);
    const service = createService();

    await (service as any).handlePresenceEventMessage(
      JSON.stringify({
        type: 'HEARTBEAT',
        userId: 'user-1',
        serverId: 'gateway-1',
        connectionId: 'socket-1',
        ts: 1000,
      }),
    );

    expect(redis.hget).toHaveBeenCalledWith('presence:user:user-1', 'status');
    expect(pipeline.hmset).toHaveBeenCalledWith('presence:user:user-1', {
      status: 'online',
      lastSeen: '1000',
      lastServerId: 'gateway-1',
    });
    expect(redis.publish).toHaveBeenCalledWith(
      'presence:updates',
      JSON.stringify({
        type: 'PRESENCE_UPDATE',
        userId: 'user-1',
        status: 'online',
        lastSeen: 1000,
      }),
    );
  });

  it('publishes an offline update immediately when the last connection disconnects', async () => {
    redis.eval.mockResolvedValue([1, 2000]);
    const service = createService();

    await (service as any).handlePresenceEventMessage(
      JSON.stringify({
        type: 'DISCONNECT',
        userId: 'user-1',
        serverId: 'gateway-1',
        connectionId: 'socket-1',
        ts: 2000,
      }),
    );

    expect(redis.eval).toHaveBeenCalled();
    expect(redis.publish).toHaveBeenCalledWith(
      'presence:updates',
      JSON.stringify({
        type: 'PRESENCE_UPDATE',
        userId: 'user-1',
        status: 'offline',
        lastSeen: 2000,
      }),
    );
  });
});
