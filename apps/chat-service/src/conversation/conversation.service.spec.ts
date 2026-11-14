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

  function MockConversationModel(this: any, data: any) {
    Object.assign(this, data);
    this._id = 'conv-created-1';
    this.hiddenFor = [];
    this.participants = data.participants || [];
    this.save = jest.fn().mockResolvedValue(this);
    this.populate = jest.fn().mockResolvedValue(this);
  }
  MockConversationModel.deleteOne = jest.fn();
  MockConversationModel.findById = jest.fn();
  MockConversationModel.findOne = jest.fn();
  MockConversationModel.find = jest.fn();
  MockConversationModel.updateOne = jest.fn();
  const conversationModel = MockConversationModel as any;

  const messageModel = {
    deleteMany: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    updateMany: jest.fn(),
  };

  const cache = {
    removeConversationFromUser: jest.fn(),
    removeConversationGlobally: jest.fn(),
    hasEmptyFlag: jest.fn(),
    getUserConversationsPage: jest.fn(),
    markEmpty: jest.fn(),
  };

  const outboxService = {
    enqueue: jest.fn(),
    enqueueChatEvent: jest.fn(),
    flushPendingChatEvents: jest.fn().mockResolvedValue(undefined),
    clearPendingChatEvents: jest.fn(),
  };

  const chatPushService = {
    clearConversationState: jest.fn().mockResolvedValue(undefined),
  };

  const createQuery = (result: any) => ({
    session: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  });

  const createService = () =>
    new ConversationService(
      conversationModel,
      messageModel as any,
      cache as any,
      outboxService as any,
      chatPushService as any,
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

    conversationModel.findById.mockReturnValue(createQuery(conv));
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
      session,
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

    conversationModel.findById
      .mockReturnValueOnce(createQuery(conv))
      .mockReturnValueOnce(createQuery(updatedConversation));
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
        conversation: expect.objectContaining(updatedConversation),
      },
      'conv-1',
      session,
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

    conversationModel.findById
      .mockReturnValueOnce(createQuery(conv))
      .mockReturnValueOnce(createQuery(updatedConversation));
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
      session,
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.updated',
      expect.objectContaining(updatedConversation),
      'conv-1',
      session,
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

    conversationModel.findById.mockReturnValue(createQuery(conv));
    const hardDeleteSpy = jest
      .spyOn(service as any, 'hardDeleteConversation')
      .mockResolvedValue(undefined);

    const result = await service.leaveConversation('user-1', 'conv-1');

    expect(result).toEqual({
      message: 'Conversation deleted because the last participant left',
    });
    expect(hardDeleteSpy).toHaveBeenCalledWith(conv, ['user-1'], session);
    expect(cache.removeConversationGlobally).toHaveBeenCalledWith('conv-1', [
      'user-1',
    ]);
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.deleted',
      {
        conversationId: 'conv-1',
        participants: ['user-1'],
      },
      'conv-1',
      session,
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

    conversationModel.findById.mockReturnValue(createQuery(conv));
    messageModel.findById
      .mockReturnValueOnce(createQuery(olderTarget))
      .mockReturnValueOnce(createQuery(previousTarget));

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

    conversationModel.findById.mockReturnValue(createQuery(conv));
    messageModel.findById
      .mockReturnValueOnce(createQuery(nextTarget))
      .mockReturnValueOnce(createQuery(previousTarget));
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
      { timestamps: false, session },
    );
    expect(outboxService.enqueueChatEvent).toHaveBeenCalledWith(
      'conversation.read',
      {
        conversationId: 'conv-1',
        userId: 'user-1',
        lastSeenMessageId: 'msg-2',
      },
      'conv-1',
      session,
    );
    expect(chatPushService.clearConversationState).toHaveBeenCalledWith(
      'user-1',
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

  it('applies search filters when querying conversations', async () => {
    const service = createService();
    const findExec = jest.fn().mockResolvedValue([]);
    const findLimit = jest.fn().mockReturnValue({ exec: findExec });
    const findPopulate = jest.fn().mockReturnValue({ limit: findLimit });
    const findSort = jest.fn().mockReturnValue({ populate: findPopulate });
    conversationModel.find.mockReturnValue({ sort: findSort });

    await service.getConversations('user-1', {
      limit: 20,
      query: 'team',
    } as any);

    expect(conversationModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: 'user-1',
        hiddenFor: { $ne: 'user-1' },
        $or: [
          { groupName: { $regex: 'team', $options: 'i' } },
          { participants: { $regex: 'team', $options: 'i' } },
        ],
      }),
    );
  });

  it('TC-CS-01: creates direct conversation with normalized sorted directKey', async () => {
    const service = createService();
    conversationModel.findOne.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(null), // no existing conversation
    });
    jest
      .spyOn(service, 'updateConversationCache')
      .mockResolvedValue({ _id: 'conv-created-1' } as any);

    const result = await service.createConversation('user-b', {
      participants: ['user-a'],
      isGroup: false,
    });

    expect(conversationModel.findOne).toHaveBeenCalledWith({
      directKey: 'user-a:user-b',
    });
    expect(result._id).toBe('conv-created-1');
  });

  it('TC-CS-02: deduplicates 1-1 conversation and returns existing conversation without creating a new document', async () => {
    const service = createService();
    const existingConv: any = {
      _id: 'conv-existing-1',
      directKey: 'user-a:user-b',
      participants: ['user-a', 'user-b'],
      hiddenFor: [],
      populate: jest.fn().mockResolvedValue(this),
    };

    conversationModel.findOne.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(existingConv),
    });
    jest
      .spyOn(service, 'updateConversationCache')
      .mockResolvedValue(existingConv);

    const result = await service.createConversation('user-a', {
      participants: ['user-b'],
      isGroup: false,
    });

    expect(conversationModel.findOne).toHaveBeenCalledWith({
      directKey: 'user-a:user-b',
    });
    expect(result._id).toBe('conv-existing-1');
  });
});
