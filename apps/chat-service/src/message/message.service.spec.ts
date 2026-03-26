import { MessageService } from './message.service';

describe('MessageService', () => {
  const messageModel = {
    findById: jest.fn(),
  };

  const conversationModel = {
    findById: jest.fn(),
  };

  const conversationService = {
    updateConversationCache: jest.fn(),
  };

  const msgCache = {
    setMessageDetail: jest.fn(),
    upsertMessageToConversationList: jest.fn(),
  };

  const outboxService = {
    enqueue: jest.fn(),
    enqueueChatEvent: jest.fn(),
  };

  const createService = () =>
    new MessageService(
      messageModel as any,
      conversationModel as any,
      conversationService as any,
      msgCache as any,
      outboxService as any
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('publishes message.deleted and conversation.updated when deleting the last message', async () => {
    const service = createService();
    const msg = {
      _id: 'msg-1',
      senderId: 'user-1',
      conversationId: 'conv-1',
      attachments: [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const conv = {
      lastMessage: { toString: () => 'msg-1' },
    };

    messageModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(msg),
    });
    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(conv),
    });
    conversationService.updateConversationCache.mockResolvedValue({
      _id: 'conv-1',
    });

    const result = await service.deleteMessage('user-1', 'msg-1');

    expect(result._id).toBe('msg-1');
    expect(msg.isDeleted).toBe(true);
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'message.deleted',
      expect.objectContaining({
        _id: 'msg-1',
        conversationId: 'conv-1',
        isDeleted: true,
      }),
      'conv-1'
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.updated',
      { _id: 'conv-1' },
      'conv-1'
    );
  });

  it('does not publish conversation.updated when deleting a non-last message', async () => {
    const service = createService();
    const msg = {
      _id: 'msg-1',
      senderId: 'user-1',
      conversationId: 'conv-1',
      attachments: [],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const conv = {
      lastMessage: { toString: () => 'msg-2' },
    };

    messageModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(msg),
    });
    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(conv),
    });

    await service.deleteMessage('user-1', 'msg-1');

    expect(outboxService.enqueueChatEvent).not.toHaveBeenCalledWith(
      'conversation.updated',
      expect.anything(),
      expect.anything()
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'message.deleted',
      expect.objectContaining({
        _id: 'msg-1',
        conversationId: 'conv-1',
        isDeleted: true,
      }),
      'conv-1'
    );
  });
});
