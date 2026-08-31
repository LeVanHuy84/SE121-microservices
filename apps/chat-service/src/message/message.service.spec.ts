import { MessageService } from './message.service';

describe('MessageService', () => {
  const session = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const connection = {
    startSession: jest.fn().mockResolvedValue(session),
  };

  const messageModel = {
    findById: jest.fn(),
  };

  const conversationModel = {
    findById: jest.fn(),
    findOne: jest.fn(),
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
    flushPendingChatEvents: jest.fn().mockResolvedValue(undefined),
    clearPendingChatEvents: jest.fn(),
  };

  const chatPushService = {
    sendMessagePush: jest.fn().mockResolvedValue(undefined),
  };

  const createService = () =>
    new MessageService(
      messageModel as any,
      conversationModel as any,
      conversationService as any,
      msgCache as any,
      outboxService as any,
      chatPushService as any,
      connection as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    connection.startSession.mockResolvedValue(session);
  });

  it('publishes message.deleted and conversation.updated when deleting the last message', async () => {
    const service = createService();
    const msg = {
      _id: 'msg-1',
      senderId: 'user-1',
      conversationId: 'conv-1',
      attachments: [],
      isDeleted: false,
      save: jest.fn().mockResolvedValue(undefined),
    };
    const conv = {
      _id: { toString: () => 'conv-1' },
      lastMessage: { toString: () => 'msg-1' },
      participants: ['user-1', 'user-2'],
    };

    messageModel.findById.mockReturnValue({
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(msg),
    });
    conversationModel.findById.mockReturnValue({
      session: jest.fn().mockReturnThis(),
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
      'conv-1',
      session,
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.updated',
      expect.anything(),
      'conv-1',
      session,
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
      _id: { toString: () => 'conv-1' },
      lastMessage: { toString: () => 'msg-2' },
      participants: ['user-1', 'user-2'],
    };

    messageModel.findById.mockReturnValue({
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(msg),
    });
    conversationModel.findById.mockReturnValue({
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(conv),
    });

    await service.deleteMessage('user-1', 'msg-1');

    expect(outboxService.enqueueChatEvent).not.toHaveBeenCalledWith(
      'conversation.updated',
      expect.anything(),
      expect.anything(),
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'message.deleted',
      expect.objectContaining({
        _id: 'msg-1',
        conversationId: 'conv-1',
        isDeleted: true,
      }),
      'conv-1',
      session,
    );
  });

  it('rejects replyTo from another conversation', async () => {
    const service = createService();
    const conv = {
      _id: 'conv-1',
      participants: ['user-1', 'user-2'],
    };
    const foreignReply = {
      _id: 'msg-x',
      conversationId: { toString: () => 'conv-2' },
    };

    conversationModel.findOne.mockReturnValue({
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(conv),
    });
    messageModel.findById.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(foreignReply),
    });

    await expect(
      service.sendMessage('user-1', {
        conversationId: 'conv-1',
        content: 'hello',
        replyTo: 'msg-x',
      } as any),
    ).rejects.toThrow('Reply message does not belong to this conversation');
  });

  it('rejects attachments larger than the configured upload limit', async () => {
    const service = createService();

    await expect(
      service.sendMessage('user-1', {
        conversationId: 'conv-1',
        content: 'hello',
        attachments: [
          {
            type: 'file',
            url: 'https://cdn.example.com/big.zip',
            size: 11 * 1024 * 1024,
          },
        ],
      } as any),
    ).rejects.toThrow('File exceeds the file upload limit of 10485760 bytes');

    expect(conversationModel.findById).not.toHaveBeenCalled();
  });

  it('maps audio and file attachments to the correct media delete resource types', async () => {
    const service = createService();

    await (service as any).enqueueMediaDeleteEvent(
      {
        attachments: [
          {
            publicId: 'audio-1',
            url: 'https://cdn.example.com/audio.mp3',
            mimeType: 'audio/mpeg',
          },
          {
            publicId: 'file-1',
            url: 'https://cdn.example.com/doc.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
      'msg-1',
      session,
    );

    expect(outboxService.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        items: [
          { publicId: 'audio-1', resourceType: 'video' },
          { publicId: 'file-1', resourceType: 'raw' },
        ],
        source: 'chat-service',
        reason: 'message.deleted',
      },
      'msg-1',
      session,
    );
  });

  it('keeps attachment semantic types when assigning media content ids', async () => {
    const service = createService();

    await (service as any).enqueueMediaAssignEvent(
      {
        attachments: [
          {
            publicId: 'audio-1',
            url: 'https://cdn.example.com/audio.mp3',
            type: 'audio',
          },
          {
            publicId: 'file-1',
            url: 'https://cdn.example.com/doc.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
      'msg-1',
      session,
    );

    expect(outboxService.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        contentId: 'msg-1',
        items: [
          {
            publicId: 'audio-1',
            url: 'https://cdn.example.com/audio.mp3',
            type: 'audio',
          },
          {
            publicId: 'file-1',
            url: 'https://cdn.example.com/doc.pdf',
            type: 'file',
          },
        ],
        source: 'chat-service',
      },
      'msg-1',
      session,
    );
  });
});
