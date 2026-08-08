import { ChatPushService } from './chat-push.service';

describe('ChatPushService', () => {
  const multi = {
    incr: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };

  const redis = {
    multi: jest.fn(() => multi),
    del: jest.fn().mockResolvedValue(1),
  };

  const firebaseService = {
    sendToMultipleDevices: jest.fn(),
    sendDataOnlyToMultipleDevices: jest.fn(),
  };

  const deviceTokenService = {
    getActiveTokensByUserId: jest.fn(),
    markTokensAsInvalid: jest.fn().mockResolvedValue(undefined),
  };
  const notificationQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };

  const policyService = {
    checkPreferencesOnly: jest.fn().mockResolvedValue({ allowed: true }),
  };

  const createService = () =>
    new ChatPushService(
      notificationQueue as any,
      redis as any,
      firebaseService as any,
      deviceTokenService as any,
      policyService as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    multi.incr.mockReturnThis();
    multi.set.mockReturnThis();
    multi.expire.mockReturnThis();
    multi.exec.mockResolvedValue([[null, 3], [null, 'OK'], [null, 'OK'], [null, 1]]);
  });

  it('increments unread state and splits Android native chat pushes to data-only delivery', async () => {
    const service = createService();
    deviceTokenService.getActiveTokensByUserId.mockResolvedValue([
      { token: 'token-1', platform: 'ios', provider: 'fcm' },
      {
        token: 'token-2',
        platform: 'android',
        provider: 'fcm',
        appId: 'com.sentimeta.app',
      },
      { token: 'token-3', platform: 'web', provider: 'fcm' },
    ]);
    firebaseService.sendDataOnlyToMultipleDevices.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      invalidTokens: [],
    });
    firebaseService.sendToMultipleDevices.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      invalidTokens: [],
    });

    await service.sendChatPush({
      userId: 'user-2',
      conversationId: 'conv-1',
      isGroup: true,
      senderId: 'user-1',
      senderName: 'An Nguyen',
      conversationName: 'SE121',
      preview: 'hello team',
      messageId: 'msg-1',
    });

    expect(multi.incr).toHaveBeenCalledWith('chat:push:user-2:conv-1:unread');
    expect(firebaseService.sendDataOnlyToMultipleDevices).toHaveBeenCalledWith(
      ['token-2'],
      expect.objectContaining({
        type: 'message',
        conversationId: 'conv-1',
        senderId: 'user-1',
        senderName: 'An Nguyen',
        unreadCount: '3',
        displayTitle: '3 tin nhắn mới',
        displayBody: 'Trong SE121',
        channelId: 'messages',
        conversationTag: 'chat:conv-1',
      }),
      expect.objectContaining({
        collapseKey: 'chat:conv-1',
      }),
    );
    expect(firebaseService.sendToMultipleDevices).toHaveBeenCalledWith(
      ['token-1', 'token-3'],
      '3 tin nhắn mới',
      'Trong SE121',
      expect.objectContaining({
        conversationId: 'conv-1',
        senderId: 'user-1',
        senderName: 'An Nguyen',
        unreadCount: '3',
      }),
      expect.objectContaining({
        collapseKey: 'chat:conv-1',
        androidTag: 'chat:conv-1',
        apnsThreadId: 'chat:conv-1',
        apnsSummaryArg: 'SE121',
        apnsSummaryArgCount: 3,
      }),
    );
  });

  it('clears cached chat push state for a conversation', async () => {
    const service = createService();

    await service.clearChatPushState({
      userId: 'user-2',
      conversationId: 'conv-1',
    });

    expect(redis.del).toHaveBeenCalledWith(
      'chat:push:user-2:conv-1:unread',
      'chat:push:user-2:conv-1:lastSender',
      'chat:push:user-2:conv-1:lastPreview',
    );
  });
});
