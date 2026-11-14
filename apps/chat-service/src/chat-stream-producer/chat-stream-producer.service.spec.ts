import { ChatStreamProducerService } from './chat-stream-producer.service';
import { ConversationResponseDTO, MessageResponseDTO } from '@repo/dtos';

describe('ChatStreamProducerService (Real-time Redis Stream Producer)', () => {
  let service: ChatStreamProducerService;
  let redis: any;

  beforeEach(() => {
    redis = {
      xadd: jest.fn().mockResolvedValue('1700000000000-0'),
    };
    service = new ChatStreamProducerService(redis);
  });

  it('publishes generic event to Redis stream with XADD and MAXLEN cap', async () => {
    const payload = { test: 123 };
    await service.publishEvent('custom.event', payload);

    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'custom.event',
      'payload',
      JSON.stringify(payload),
    );
  });

  it('publishes message.created event with correct payload', async () => {
    const msg = {
      _id: 'msg-1',
      conversationId: 'conv-1',
      senderId: 'user-1',
      content: 'Hello World',
    } as MessageResponseDTO;

    await service.publishMessageCreated(msg);

    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'message.created',
      'payload',
      JSON.stringify(msg),
    );
  });

  it('publishes message.deleted event with correct payload', async () => {
    const msg = {
      _id: 'msg-1',
      conversationId: 'conv-1',
      isDeleted: true,
    } as MessageResponseDTO;

    await service.publishMessageDeleted(msg);

    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'message.deleted',
      'payload',
      JSON.stringify(msg),
    );
  });

  it('publishes conversation.created and conversation.updated events', async () => {
    const conv = { _id: 'conv-123', type: 'DIRECT' } as ConversationResponseDTO;

    await service.publishConversationCreated(conv);
    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'conversation.created',
      'payload',
      JSON.stringify(conv),
    );

    await service.publishConversationUpdated(conv);
    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'conversation.updated',
      'payload',
      JSON.stringify(conv),
    );
  });

  it('publishes conversation membership events: memberJoined, memberLeft, deleted', async () => {
    const conv = { _id: 'conv-grp' } as ConversationResponseDTO;

    await service.publishConversationMemberJoined({
      conversation: conv,
      joinedUserIds: ['user-2'],
    });
    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'conversation.memberJoined',
      'payload',
      JSON.stringify({ conversation: conv, joinedUserIds: ['user-2'] }),
    );

    await service.publishConversationMemberLeft({
      conversationId: 'conv-grp',
      leftUserIds: ['user-2'],
    });
    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'conversation.memberLeft',
      'payload',
      JSON.stringify({ conversationId: 'conv-grp', leftUserIds: ['user-2'] }),
    );

    await service.publishConversationDeleted({
      conversationId: 'conv-grp',
      participants: ['user-1', 'user-2'],
    });
    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'conversation.deleted',
      'payload',
      JSON.stringify({
        conversationId: 'conv-grp',
        participants: ['user-1', 'user-2'],
      }),
    );
  });

  it('publishes conversation state events: read, hidden, unhidden', async () => {
    await service.publishConversationRead({
      conversationId: 'conv-1',
      userId: 'user-1',
      lastSeenMessageId: 'msg-99',
    });
    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'conversation.read',
      'payload',
      JSON.stringify({
        conversationId: 'conv-1',
        userId: 'user-1',
        lastSeenMessageId: 'msg-99',
      }),
    );

    await service.publishConversationHidden({
      conversationId: 'conv-1',
      userId: 'user-1',
    });
    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'conversation.hidden',
      'payload',
      JSON.stringify({ conversationId: 'conv-1', userId: 'user-1' }),
    );

    const conv = { _id: 'conv-1' } as ConversationResponseDTO;
    await service.publishConversationUnhidden({
      userId: 'user-1',
      conversation: conv,
    });
    expect(redis.xadd).toHaveBeenCalledWith(
      'chat:events',
      'MAXLEN',
      '~',
      10000,
      '*',
      'event',
      'conversation.unhidden',
      'payload',
      JSON.stringify({ userId: 'user-1', conversation: conv }),
    );
  });
});
