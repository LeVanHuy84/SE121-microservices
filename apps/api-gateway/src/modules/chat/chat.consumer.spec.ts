import { ChatStreamConsumer } from './chat.consumer';

describe('ChatStreamConsumer', () => {
  const redis = {
    xack: jest.fn(),
    eval: jest.fn(),
  };

  const chatGateway = {
    emitConversationHidden: jest.fn(),
    emitConversationUnhidden: jest.fn(),
  };

  const createConsumer = () =>
    new ChatStreamConsumer(redis as any, chatGateway as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits conversation.hidden to the gateway', async () => {
    const consumer = createConsumer();

    await (consumer as any).processEntry('1-0', [
      'event',
      'conversation.hidden',
      'payload',
      JSON.stringify({ conversationId: 'conv-1', userId: 'user-1' }),
    ]);

    expect(chatGateway.emitConversationHidden).toHaveBeenCalledWith(
      'conv-1',
      'user-1'
    );
    expect(redis.xack).toHaveBeenCalledWith(
      'chat:events',
      'chat-gateway',
      '1-0'
    );
  });

  it('emits conversation.unhidden when the event passes version gate', async () => {
    const consumer = createConsumer();
    jest
      .spyOn(consumer as any, 'shouldProcessConversationEvent')
      .mockResolvedValue(true);

    await (consumer as any).processEntry('2-0', [
      'event',
      'conversation.unhidden',
      'payload',
      JSON.stringify({
        userId: 'user-1',
        conversation: { _id: 'conv-1', syncVersion: 1 },
      }),
    ]);

    expect(chatGateway.emitConversationUnhidden).toHaveBeenCalledWith(
      { _id: 'conv-1', syncVersion: 1 },
      'user-1'
    );
    expect(redis.xack).toHaveBeenCalledWith(
      'chat:events',
      'chat-gateway',
      '2-0'
    );
  });
});
