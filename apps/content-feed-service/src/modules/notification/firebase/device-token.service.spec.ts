import { DeviceTokenService } from "./device-token.service";

describe("DeviceTokenService", () => {
  const existingToken = {
    userId: "user-1",
    token: "fcm-token",
    platform: "ios",
    provider: "fcm",
    appId: "com.sentimeta.app",
    lastUsed: new Date("2026-04-05T00:00:00.000Z"),
    isActive: true,
  };

  const deviceTokenModel = {
    find: jest.fn(),
    deleteMany: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  const createService = () => new DeviceTokenService(deviceTokenModel as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("defaults provider to fcm when registering a token", async () => {
    const service = createService();
    deviceTokenModel.findOneAndUpdate.mockResolvedValue({
      userId: "user-1",
      token: "fcm-token",
      platform: "android",
      provider: "fcm",
      appId: "com.sentimeta.app",
    });

    await service.registerToken({
      userId: "user-1",
      token: "fcm-token",
      platform: "android",
      appId: "com.sentimeta.app",
    });

    expect(deviceTokenModel.deleteMany).toHaveBeenCalledWith({
      token: "fcm-token",
      userId: { $ne: "user-1" },
    });
    expect(deviceTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        userId: "user-1",
        token: "fcm-token",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          platform: "android",
          provider: "fcm",
          appId: "com.sentimeta.app",
          isActive: true,
        }),
      }),
      { new: true, upsert: true },
    );
  });

  it("updates an existing token with provider and app id", async () => {
    const service = createService();
    deviceTokenModel.findOneAndUpdate.mockResolvedValue(existingToken);

    const result = await service.registerToken({
      userId: "user-1",
      token: "fcm-token",
      platform: "ios",
      provider: "fcm",
      appId: "com.sentimeta.app",
    });

    expect(result).toBe(existingToken);
    expect(deviceTokenModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        userId: "user-1",
        token: "fcm-token",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          platform: "ios",
          provider: "fcm",
          appId: "com.sentimeta.app",
          isActive: true,
        }),
      }),
      { new: true, upsert: true },
    );
  });

  it("returns only active fcm tokens for delivery", async () => {
    const service = createService();
    const lean = jest.fn().mockResolvedValue([
      {
        token: "token-1",
        platform: "android",
        provider: "fcm",
        appId: "com.sentimeta.app",
        deviceId: "device-1",
        deviceName: "Pixel",
      },
    ]);
    const select = jest.fn().mockReturnValue({ lean });
    deviceTokenModel.find.mockReturnValue({ select });

    const result = await service.getActiveTokensByUserId("user-1");

    expect(deviceTokenModel.find).toHaveBeenCalledWith({
      userId: "user-1",
      isActive: true,
      provider: "fcm",
    });
    expect(result).toEqual([
      {
        token: "token-1",
        platform: "android",
        provider: "fcm",
        appId: "com.sentimeta.app",
        deviceId: "device-1",
        deviceName: "Pixel",
      },
    ]);
  });
});
