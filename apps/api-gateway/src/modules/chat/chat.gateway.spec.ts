import { of, throwError } from 'rxjs';
import { ChatGateway } from './chat.gateway';

describe('ChatGateway', () => {
  const redis = {
    duplicate: jest.fn(),
    publish: jest.fn(),
  };

  const chatClient = {
    send: jest.fn(),
  };

  const createGateway = () => {
    const gateway = new ChatGateway(redis as any, chatClient as any);
    return gateway;
  };

  const createClient = () =>
    ({
      id: 'socket-1',
      user: { id: 'user-1' },
      data: {},
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('joins a conversation only after access verification succeeds', async () => {
    const gateway = createGateway();
    const client = createClient();
    chatClient.send.mockReturnValue(of({ _id: 'conv-1' }));

    await gateway.handleJoinConversation(client, { conversationId: 'conv-1' });

    expect(chatClient.send).toHaveBeenCalledWith('getConversationById', {
      userId: 'user-1',
      conversationId: 'conv-1',
    });
    expect(client.join).toHaveBeenCalledWith('conversation:conv-1');
    expect(client.emit).not.toHaveBeenCalledWith(
      'conversation.error',
      expect.anything()
    );
  });

  it('rejects a conversation join when access verification fails', async () => {
    const gateway = createGateway();
    const client = createClient();
    chatClient.send.mockReturnValue(
      throwError(() => new Error('forbidden conversation'))
    );

    await gateway.handleJoinConversation(client, { conversationId: 'conv-1' });

    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('conversation.error', {
      conversationId: 'conv-1',
      message: 'Forbidden conversation access',
    });
  });

  it('blocks typing events when the socket has no conversation access', async () => {
    const gateway = createGateway();
    const client = createClient();
    const emit = jest.fn();
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit }),
    } as any;
    chatClient.send.mockReturnValue(
      throwError(() => new Error('forbidden conversation'))
    );

    await gateway.handleTypingStart(client, { conversationId: 'conv-1' });

    expect(emit).not.toHaveBeenCalled();
  });
});
