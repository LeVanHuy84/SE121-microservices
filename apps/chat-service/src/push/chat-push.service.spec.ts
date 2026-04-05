import { ChatPushService } from './chat-push.service';

describe('ChatPushService', () => {
  const notificationService = {
    sendChatPush: jest.fn().mockResolvedValue(undefined),
    clearChatPushState: jest.fn().mockResolvedValue(undefined),
  };

  const conversationActivityService = {
    filterReceiversOutsideConversation: jest.fn(),
  };

  const userClientService = {
    getUserInfo: jest.fn(),
  };

  const createService = () =>
    new ChatPushService(
      notificationService as any,
      conversationActivityService as any,
      userClientService as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches chat push only to receivers outside the active conversation', async () => {
    const service = createService();
    conversationActivityService.filterReceiversOutsideConversation.mockResolvedValue(
      ['user-2'],
    );
    userClientService.getUserInfo.mockResolvedValue({
      id: 'user-1',
      firstName: 'An',
      lastName: 'Nguyen',
      avatarUrl: 'https://cdn.example.com/an.png',
    });

    await service.sendMessagePush({
      senderId: 'user-1',
      conversationId: 'conv-1',
      conversationName: 'SE121',
      isGroup: true,
      receiverIds: ['user-2', 'user-3'],
      messageId: 'msg-1',
      preview: 'hello',
    });

    expect(
      conversationActivityService.filterReceiversOutsideConversation,
    ).toHaveBeenCalledWith(['user-2', 'user-3'], 'conv-1');
    expect(notificationService.sendChatPush).toHaveBeenCalledTimes(1);
    expect(notificationService.sendChatPush).toHaveBeenCalledWith({
      userId: 'user-2',
      conversationId: 'conv-1',
      isGroup: true,
      senderId: 'user-1',
      senderName: 'An Nguyen',
      senderAvatar: 'https://cdn.example.com/an.png',
      conversationName: 'SE121',
      preview: 'hello',
      messageId: 'msg-1',
    });
  });

  it('clears chat push state through notification-service', async () => {
    const service = createService();

    await service.clearConversationState('user-2', 'conv-1');

    expect(notificationService.clearChatPushState).toHaveBeenCalledWith({
      userId: 'user-2',
      conversationId: 'conv-1',
    });
  });
});
