import { ChatStreamConsumer } from "./chat.consumer";

describe("ChatStreamConsumer (Suite 4: Redis Stream Event Consumption & Recovery)", () => {
  const redis = {
    xack: jest.fn(),
    eval: jest.fn(),
    xreadgroup: jest.fn(),
    xlen: jest.fn(),
  };

  const chatGateway = {
    emitConversationHidden: jest.fn(),
    emitConversationUnhidden: jest.fn(),
    broadcastNewMessage: jest.fn(),
    broadcastMessageDeleted: jest.fn(),
    emitConversationCreated: jest.fn(),
    emitConversationUpdated: jest.fn(),
  };

  const createConsumer = () =>
    new ChatStreamConsumer(redis as any, chatGateway as any);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("emits conversation.hidden to the gateway and ACKs the message", async () => {
    const consumer = createConsumer();

    await (consumer as any).processEntry("1-0", [
      "event",
      "conversation.hidden",
      "payload",
      JSON.stringify({ conversationId: "conv-1", userId: "user-1" }),
    ]);

    expect(chatGateway.emitConversationHidden).toHaveBeenCalledWith(
      "conv-1",
      "user-1",
    );
    expect(redis.xack).toHaveBeenCalledWith(
      "chat:events",
      "chat-gateway",
      "1-0",
    );
  });

  it("emits conversation.unhidden when the event passes version gate", async () => {
    const consumer = createConsumer();
    jest
      .spyOn(consumer as any, "shouldProcessConversationEvent")
      .mockResolvedValue(true);

    await (consumer as any).processEntry("2-0", [
      "event",
      "conversation.unhidden",
      "payload",
      JSON.stringify({
        userId: "user-1",
        conversation: { _id: "conv-1", syncVersion: 1 },
      }),
    ]);

    expect(chatGateway.emitConversationUnhidden).toHaveBeenCalledWith(
      { _id: "conv-1", syncVersion: 1 },
      "user-1",
    );
    expect(redis.xack).toHaveBeenCalledWith(
      "chat:events",
      "chat-gateway",
      "2-0",
    );
  });

  it("TC-GW-19: processes message.created event and broadcasts new message to clients", async () => {
    const consumer = createConsumer();
    jest
      .spyOn(consumer as any, "shouldProcessMessageEvent")
      .mockResolvedValue(true);

    const messagePayload = {
      _id: "msg-123",
      conversationId: "conv-456",
      senderId: "user-1",
      content: "Hello from Redis Stream!",
      syncVersion: 1,
    };

    await (consumer as any).processEntry("3-0", [
      "event",
      "message.created",
      "payload",
      JSON.stringify(messagePayload),
    ]);

    expect(chatGateway.broadcastNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "msg-123",
        content: "Hello from Redis Stream!",
      }),
    );
    expect(redis.xack).toHaveBeenCalledWith(
      "chat:events",
      "chat-gateway",
      "3-0",
    );
  });

  it("processes message.deleted event and broadcasts deletion to clients", async () => {
    const consumer = createConsumer();
    jest
      .spyOn(consumer as any, "shouldProcessMessageEvent")
      .mockResolvedValue(true);

    const messagePayload = {
      _id: "msg-deleted-1",
      conversationId: "conv-456",
      isDeleted: true,
      syncVersion: 2,
    };

    await (consumer as any).processEntry("4-0", [
      "event",
      "message.deleted",
      "payload",
      JSON.stringify(messagePayload),
    ]);

    expect(chatGateway.broadcastMessageDeleted).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "msg-deleted-1", isDeleted: true }),
    );
    expect(redis.xack).toHaveBeenCalledWith(
      "chat:events",
      "chat-gateway",
      "4-0",
    );
  });

  it("TC-GW-20: replays pending messages during startup (replayPending) and acks them", async () => {
    const consumer = createConsumer();
    jest.spyOn(consumer as any, "processEntry").mockResolvedValue(undefined);

    redis.xreadgroup
      .mockResolvedValueOnce([
        [
          "chat:events",
          [
            [
              "100-0",
              [
                "event",
                "conversation.created",
                "payload",
                JSON.stringify({ _id: "conv-new" }),
              ],
            ],
          ],
        ],
      ])
      .mockResolvedValueOnce(null); // End of pending

    await (consumer as any).replayPending();

    expect(redis.xreadgroup).toHaveBeenCalledWith(
      "GROUP",
      "chat-gateway",
      expect.any(String),
      "COUNT",
      expect.any(Number),
      "STREAMS",
      "chat:events",
      "0",
    );
    expect((consumer as any).processEntry).toHaveBeenCalledWith(
      "100-0",
      expect.arrayContaining(["conversation.created"]),
    );
  });
});
