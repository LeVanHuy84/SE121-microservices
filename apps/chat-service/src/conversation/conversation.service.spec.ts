import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
  const session = {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const connection = {
    startSession: jest.fn().mockResolvedValue(session),
  };

  const conversationModel = {
    findById: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(),
  };

  const messageModel = {
    deleteMany: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    updateMany: jest.fn(),
  };

  const cache = {
    removeConversationFromUser: jest.fn(),
    removeConversationGlobally: jest.fn(),
  };

  const outboxService = {
    enqueue: jest.fn(),
    enqueueChatEvent: jest.fn(),
  };

  const createService = () =>
    new ConversationService(
      conversationModel as any,
      messageModel as any,
      cache as any,
      outboxService as any,
      connection as any,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    connection.startSession.mockResolvedValue(session);
    session.commitTransaction.mockResolvedValue(undefined);
    session.abortTransaction.mockResolvedValue(undefined);
    session.endSession.mockResolvedValue(undefined);
  });

  it('publishes hidden event when a conversation is hidden', async () => {
    const service = createService();
    const conv = {
      _id: 'conv-1',
      participants: ['user-1', 'user-2'],
      hiddenFor: [],
      save: jest.fn().mockResolvedValue(undefined),
    };

    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(conv),
    });
    jest
      .spyOn(service, 'updateConversationCache')
      .mockResolvedValue({ _id: 'conv-1' } as any);

    const result = await service.hideConversationForUser('user-1', 'conv-1');

    expect(result).toEqual({ message: 'Conversation hidden' });
    expect(conv.hiddenFor).toEqual(['user-1']);
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.hidden',
      {
        conversationId: 'conv-1',
        userId: 'user-1',
      },
      'conv-1',
    );
  });

  it('publishes unhidden event with refreshed conversation payload', async () => {
    const service = createService();
    const conv = {
      _id: 'conv-1',
      participants: ['user-1', 'user-2'],
      hiddenFor: ['user-1'],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const updatedConversation = {
      _id: 'conv-1',
      participants: ['user-1', 'user-2'],
      hiddenFor: [],
    };

    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(conv),
    });
    jest
      .spyOn(service, 'updateConversationCache')
      .mockResolvedValue(updatedConversation as any);

    const result = await service.unhideConversationForUser('user-1', 'conv-1');

    expect(result).toEqual({ message: 'Conversation unhidden' });
    expect(conv.hiddenFor).toEqual([]);
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.unhidden',
      {
        userId: 'user-1',
        conversation: updatedConversation,
      },
      'conv-1',
    );
  });

  it('publishes memberLeft and updated events when leaving a non-empty group', async () => {
    const service = createService();
    const conv = {
      _id: { toString: () => 'conv-1' },
      isGroup: true,
      participants: ['user-1', 'user-2'],
      admins: ['user-1'],
      hiddenFor: ['user-1'],
      save: jest.fn().mockResolvedValue(undefined),
    };
    const updatedConversation = {
      _id: 'conv-1',
      participants: ['user-2'],
      admins: ['user-2'],
    };

    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(conv),
    });
    jest
      .spyOn(service, 'updateConversationCache')
      .mockResolvedValue(updatedConversation as any);

    const result = await service.leaveConversation('user-1', 'conv-1');

    expect(result).toEqual({ message: 'You have left the conversation' });
    expect(cache.removeConversationFromUser).toHaveBeenCalledWith(
      'user-1',
      'conv-1',
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.memberLeft',
      {
        conversationId: 'conv-1',
        leftUserIds: ['user-1'],
      },
      'conv-1',
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.updated',
      updatedConversation,
      'conv-1',
    );
  });

  it('hard deletes the conversation when the last participant leaves', async () => {
    const service = createService();
    const conv = {
      _id: { toString: () => 'conv-1' },
      isGroup: true,
      participants: ['user-1'],
      admins: ['user-1'],
      hiddenFor: [],
      save: jest.fn().mockResolvedValue(undefined),
    };

    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(conv),
    });
    const hardDeleteSpy = jest
      .spyOn(service as any, 'hardDeleteConversation')
      .mockResolvedValue(undefined);

    const result = await service.leaveConversation('user-1', 'conv-1');

    expect(result).toEqual({
      message: 'Conversation deleted because the last participant left',
    });
    expect(hardDeleteSpy).toHaveBeenCalledWith(conv, ['user-1']);
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.deleted',
      {
        conversationId: 'conv-1',
        participants: ['user-1'],
      },
      'conv-1',
    );
  });

  it('does not move read state backwards when the requested message is older', async () => {
    const service = createService();
    const conv = {
      _id: 'conv-1',
      participants: ['user-1', 'user-2'],
      lastSeenMessageId: new Map([['user-1', 'msg-2']]),
    };
    const olderTarget = {
      _id: { toString: () => 'msg-1' },
      conversationId: { toString: () => 'conv-1' },
      createdAt: new Date('2026-03-26T10:00:00.000Z'),
    };
    const previousTarget = {
      _id: { toString: () => 'msg-2' },
      conversationId: { toString: () => 'conv-1' },
      createdAt: new Date('2026-03-26T10:05:00.000Z'),
    };

    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(conv),
    });
    messageModel.findById
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(olderTarget),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(previousTarget),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(olderTarget),
      });

    const result = await service.markConversationAsRead(
      'user-1',
      'conv-1',
      'msg-1',
    );

    expect(result).toBe('msg-2');
    expect(messageModel.updateMany).not.toHaveBeenCalled();
    expect(conversationModel.updateOne).not.toHaveBeenCalled();
    expect(outboxService.enqueueChatEvent).not.toHaveBeenCalled();
  });

  it('updates seen state and publishes conversation.read when read state moves forward', async () => {
    const service = createService();
    const conv = {
      _id: 'conv-1',
      toObject: () => ({
        _id: 'conv-1',
        participants: ['user-1', 'user-2'],
        lastSeenMessageId: { 'user-1': 'msg-1' },
      }),
      participants: ['user-1', 'user-2'],
      lastSeenMessageId: new Map([['user-1', 'msg-1']]),
    };
    const nextTarget = {
      _id: { toString: () => 'msg-2' },
      conversationId: { toString: () => 'conv-1' },
      createdAt: new Date('2026-03-26T10:10:00.000Z'),
    };
    const previousTarget = {
      _id: { toString: () => 'msg-1' },
      conversationId: { toString: () => 'conv-1' },
      createdAt: new Date('2026-03-26T10:05:00.000Z'),
    };

    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue(conv),
    });
    messageModel.findById
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(nextTarget),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(previousTarget),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(nextTarget),
      });
    conversationModel.updateOne.mockResolvedValue(undefined);
    messageModel.updateMany.mockResolvedValue(undefined);
    jest
      .spyOn(service, 'updateConversationCache')
      .mockResolvedValue({ _id: 'conv-1' } as any);

    const result = await service.markConversationAsRead(
      'user-1',
      'conv-1',
      'msg-2',
    );

    expect(result).toBe('msg-2');
    expect(messageModel.updateMany).toHaveBeenCalled();
    expect(conversationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'conv-1' },
      {
        $set: {
          'lastSeenMessageId.user-1': 'msg-2',
          syncVersion: expect.any(Number),
        },
      },
      { timestamps: false },
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.read',
      {
        conversationId: 'conv-1',
        userId: 'user-1',
        lastSeenMessageId: 'msg-2',
      },
      'conv-1',
    );
  });

  it('filters hidden conversations in DB fallback queries', async () => {
    const service = createService();
    const findExec = jest.fn().mockResolvedValue([]);
    const findLimit = jest.fn().mockReturnValue({ exec: findExec });
    const findPopulate = jest.fn().mockReturnValue({ limit: findLimit });
    const findSort = jest.fn().mockReturnValue({ populate: findPopulate });
    conversationModel.find.mockReturnValue({ sort: findSort });
    cache.hasEmptyFlag = jest.fn().mockResolvedValue(false);
    cache.getUserConversationsPage = jest.fn().mockResolvedValue(null);
    cache.markEmpty = jest.fn().mockResolvedValue(undefined);

    await service.getConversations('user-1', { limit: 20 } as any);

    expect(conversationModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: 'user-1',
        hiddenFor: { $ne: 'user-1' },
      }),
    );
  });
});
