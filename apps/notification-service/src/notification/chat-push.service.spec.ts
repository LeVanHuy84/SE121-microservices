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
  };

  const deviceTokenService = {
    getActiveTokensByUserId: jest.fn(),
    markTokensAsInvalid: jest.fn().mockResolvedValue(undefined),
  };

  const createService = () =>
    new ChatPushService(
      redis as any,
      firebaseService as any,
      deviceTokenService as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    multi.incr.mockReturnThis();
    multi.set.mockReturnThis();
    multi.expire.mockReturnThis();
    multi.exec.mockResolvedValue([[null, 3], [null, 'OK'], [null, 'OK'], [null, 1]]);
  });

  it('increments unread state and sends grouped FCM payload for a group conversation', async () => {
    const service = createService();
    deviceTokenService.getActiveTokensByUserId.mockResolvedValue([
      { token: 'token-1', platform: 'ios' },
      { token: 'token-2', platform: 'android' },
    ]);
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
    expect(firebaseService.sendToMultipleDevices).toHaveBeenCalledWith(
      ['token-1', 'token-2'],
      '3 tin nhan moi',
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
