import { StreamMediaProvider } from './stream-media.provider';
import { RpcException } from '@nestjs/microservices';

const mockStreamClientInstance = {
  generateUserToken: jest.fn().mockReturnValue('mocked-stream-jwt-token'),
  video: {
    getOrCreateCall: jest.fn().mockResolvedValue({}),
    call: jest.fn().mockReturnValue({
      getOrCreate: jest.fn().mockResolvedValue({}),
      get: jest
        .fn()
        .mockResolvedValue({ call: { session: { participants: [1, 2] } } }),
      end: jest.fn().mockResolvedValue({}),
    }),
  },
};

jest.mock('@stream-io/node-sdk', () => ({
  StreamClient: jest.fn().mockImplementation(() => mockStreamClientInstance),
}));

describe('StreamMediaProvider (Suite 6: Stream Video Token Issuance & Media Infra)', () => {
  let provider: StreamMediaProvider;
  let configService: any;
  let redis: any;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'STREAM_API_KEY') return 'test-key';
        if (key === 'STREAM_API_SECRET') return 'test-secret';
        if (key === 'STREAM_CALL_TYPE') return 'default';
        if (key === 'STREAM_TOKEN_TTL_SEC') return 3600;
        return null;
      }),
    };
    redis = {
      exists: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
    };
    provider = new StreamMediaProvider(configService, redis);
  });

  it('TC-CS-09: issueUserToken generates Stream JWT token with validity TTL', async () => {
    const token = await provider.issueUserToken('user-test-123');

    expect(token).toBe('mocked-stream-jwt-token');
    expect(mockStreamClientInstance.generateUserToken).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-test-123',
        exp: expect.any(Number),
        iat: expect.any(Number),
      }),
    );
  });

  it('throws RpcException when Stream credentials are not configured', async () => {
    const emptyConfigService: any = {
      get: jest.fn().mockReturnValue(''),
    };
    const brokenProvider = new StreamMediaProvider(emptyConfigService, redis);

    await expect(brokenProvider.issueUserToken('user-1')).rejects.toThrow(
      new RpcException('Stream media infra is not configured'),
    );
  });

  it('registers call room with members and custom metadata on Stream', async () => {
    await provider.registerCall({
      callId: 'call-123',
      conversationId: 'conv-456',
      initiatorId: 'user-1',
      participants: ['user-1', 'user-2'],
      moderatorUserIds: ['user-1'],
    });

    expect(mockStreamClientInstance.video.getOrCreateCall).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'default',
        id: 'call-123',
      }),
    );
  });

  it('ends call on Stream video client', async () => {
    await provider.endCallOnStream('call-123');

    expect(mockStreamClientInstance.video.call).toHaveBeenCalledWith(
      'default',
      'call-123',
    );
  });

  it('returns active participants count from Stream call session', async () => {
    const count = await provider.getActiveParticipantsCount('call-123');

    expect(count).toBe(2);
  });
});
