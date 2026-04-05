import { DeviceTokenService } from './device-token.service';

describe('DeviceTokenService', () => {
  const existingToken = {
    lastUsed: new Date('2026-04-05T00:00:00.000Z'),
    isActive: false,
    platform: 'android',
    provider: 'fcm',
    save: jest.fn().mockResolvedValue(undefined),
  };

  const deviceTokenModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    find: jest.fn(),
  };

  const createService = () => new DeviceTokenService(deviceTokenModel as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('defaults provider to fcm when registering a token', async () => {
    const service = createService();
    deviceTokenModel.findOne.mockResolvedValue(null);
    deviceTokenModel.create.mockResolvedValue({
      userId: 'user-1',
      token: 'fcm-token',
      platform: 'android',
      provider: 'fcm',
    });

    await service.registerToken({
      userId: 'user-1',
      token: 'fcm-token',
      platform: 'android',
      appId: 'com.sentimeta.app',
    });

    expect(deviceTokenModel.findOne).toHaveBeenCalledWith({
      userId: 'user-1',
      token: 'fcm-token',
      provider: 'fcm',
    });
    expect(deviceTokenModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        token: 'fcm-token',
        platform: 'android',
        provider: 'fcm',
        appId: 'com.sentimeta.app',
      }),
    );
  });

  it('updates an existing token with provider and app id', async () => {
    const service = createService();
    deviceTokenModel.findOne.mockResolvedValue(existingToken);

    const result = await service.registerToken({
      userId: 'user-1',
      token: 'fcm-token',
      platform: 'ios',
      provider: 'fcm',
      appId: 'com.sentimeta.app',
    });

    expect(result).toBe(existingToken);
    expect(existingToken.platform).toBe('ios');
    expect(existingToken.provider).toBe('fcm');
    expect((existingToken as any).appId).toBe('com.sentimeta.app');
    expect(existingToken.save).toHaveBeenCalled();
  });

  it('returns only active fcm tokens for delivery', async () => {
    const service = createService();
    const lean = jest.fn().mockResolvedValue([
      { token: 'token-1', platform: 'android', provider: 'fcm' },
    ]);
    const select = jest.fn().mockReturnValue({ lean });
    deviceTokenModel.find.mockReturnValue({ select });

    const result = await service.getActiveTokensByUserId('user-1');

    expect(deviceTokenModel.find).toHaveBeenCalledWith({
      userId: 'user-1',
      isActive: true,
      provider: 'fcm',
    });
    expect(result).toEqual([
      { token: 'token-1', platform: 'android', provider: 'fcm' },
    ]);
  });
});
