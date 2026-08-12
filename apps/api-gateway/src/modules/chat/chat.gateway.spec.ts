import { of, throwError } from "rxjs";
import { ChatGateway } from "./chat.gateway";

describe("ChatGateway", () => {
  const pipeline = {
    set: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    srem: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  const redis = {
    duplicate: jest.fn(),
    publish: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn(() => pipeline),
    get: jest.fn(),
  };

  const chatClient = {
    send: jest.fn(),
  };

  const presenceTracker = {
    setServer: jest.fn(),
  };

  const createGateway = () => {
    const gateway = new ChatGateway(redis as any, chatClient as any, presenceTracker as any);
    return gateway;
  };

  const createClient = () =>
    ({
      id: "socket-1",
      user: { id: "user-1" },
      data: {},
      join: jest.fn(),
      leave: jest.fn(),
      emit: jest.fn(),
    }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.pipeline.mockReturnValue(pipeline);
    pipeline.set.mockReturnThis();
    pipeline.sadd.mockReturnThis();
    pipeline.expire.mockReturnThis();
    pipeline.del.mockReturnThis();
    pipeline.srem.mockReturnThis();
    pipeline.exec.mockResolvedValue([]);
  });

  it("joins a conversation only after access verification succeeds", async () => {
    const gateway = createGateway();
    const client = createClient();
    chatClient.send.mockReturnValue(of({ _id: "conv-1" }));

    await gateway.handleJoinConversation(client, { conversationId: "conv-1" });

    expect(chatClient.send).toHaveBeenCalledWith("getConversationById", {
      userId: "user-1",
      conversationId: "conv-1",
    });
    expect(client.join).toHaveBeenCalledWith("conversation:conv-1");
    expect(pipeline.set).toHaveBeenCalledWith(
      "chat:activeConv:conn:user-1:socket-1",
      "conv-1",
      "EX",
      60,
    );
    expect(client.emit).not.toHaveBeenCalledWith(
      "conversation.error",
      expect.anything(),
    );
  });

  it("rejects a conversation join when access verification fails", async () => {
    const gateway = createGateway();
    const client = createClient();
    chatClient.send.mockReturnValue(
      throwError(() => new Error("forbidden conversation")),
    );

    await gateway.handleJoinConversation(client, { conversationId: "conv-1" });

    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith("conversation.error", {
      conversationId: "conv-1",
      message: "Forbidden conversation access",
    });
  });

  it("blocks typing events when the socket has no conversation access", async () => {
    const gateway = createGateway();
    const client = createClient();
    const emit = jest.fn();
    gateway.server = {
      to: jest.fn().mockReturnValue({ emit }),
    } as any;
    chatClient.send.mockReturnValue(
      throwError(() => new Error("forbidden conversation")),
    );

    await gateway.handleTypingStart(client, { conversationId: "conv-1" });

    expect(emit).not.toHaveBeenCalled();
  });

  it("publishes heartbeats to the presence events channel", () => {
    const gateway = createGateway();
    const client = createClient();

    gateway.handleHeartbeat(client);

    expect(redis.publish).toHaveBeenCalledWith(
      "presence:events",
      expect.any(String),
    );
    const payload = JSON.parse(redis.publish.mock.calls[0][1]);
    expect(payload).toEqual(
      expect.objectContaining({
        type: "HEARTBEAT",
        userId: "user-1",
        connectionId: "socket-1",
      }),
    );
  });

  it("publishes a disconnect event when a socket disconnects", async () => {
    const gateway = createGateway();
    const client = createClient();
    client.data.activeConversationId = "conv-1";

    await gateway.handleDisconnect(client);

    expect(redis.publish).toHaveBeenCalledWith(
      "presence:events",
      expect.any(String),
    );
    const payload = JSON.parse(redis.publish.mock.calls[0][1]);
    expect(payload).toEqual(
      expect.objectContaining({
        type: "DISCONNECT",
        userId: "user-1",
        connectionId: "socket-1",
      }),
    );
    expect(pipeline.del).toHaveBeenCalledWith(
      "chat:activeConv:conn:user-1:socket-1",
    );
    expect(pipeline.srem).toHaveBeenCalledWith(
      "chat:activeConv:user:user-1:conv-1",
      "socket-1",
    );
  });
});
