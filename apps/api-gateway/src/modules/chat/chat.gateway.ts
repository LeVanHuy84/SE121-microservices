import { InjectRedis } from "@nestjs-modules/ioredis";
import { Inject, Logger } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { ConversationResponseDTO, MessageResponseDTO } from "@repo/dtos";
import Redis from "ioredis";
import { lastValueFrom } from "rxjs";
import { Server, Socket } from "socket.io";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { clerkWsMiddleware } from "src/common/middlewares/clerk-ws.middleware";
import { PresenceTrackerService } from "./services/presence-tracker.service";

@WebSocketGateway({
  namespace: "/chat",
  cors: {
    origin: "*",
  },
  transports: ["websocket"],
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private readonly ACTIVE_CONVERSATION_TTL_SECONDS = Number(
    process.env.CHAT_ACTIVE_CONVERSATION_TTL_SECONDS ?? 60,
  );
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE)
    private readonly chatClient: ClientProxy,
    private readonly presenceTracker: PresenceTrackerService,
  ) {}

  afterInit(server: Server) {
    server.use(clerkWsMiddleware);
    this.presenceTracker.setServer(server);
  }

  async handleConnection(client: Socket) {
    const userId = client.user?.id;
    if (!userId) {
      this.logger.warn("❌ Unauthorized client tried to connect");
      client.disconnect(true);
      return;
    }

    client.join(`user:${userId}`);

    this.logger.log(`✅ Client connected: ${userId}`);
  }
  async handleDisconnect(client: Socket) {
    const userId = client.user?.id;
    if (!userId) return;
    await this.clearActiveConversation(client);
    await this.presenceTracker.handleDisconnect(client);
    this.logger.log(`❌ Client disconnected: ${client.user?.id}`);
  }

  @SubscribeMessage("heartbeat")
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    await this.presenceTracker.handleHeartbeat(
      client,
      this.refreshActiveConversation.bind(this),
    );
  }

  // ========== Client subscribe / unsubscribe presence của người khác ==========

  @SubscribeMessage("presence.subscribe")
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userIds: string[] },
  ) {
    await this.presenceTracker.handleSubscribe(client, data?.userIds);
  }

  @SubscribeMessage("presence.unsubscribe")
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userIds: string[] },
  ) {
    this.presenceTracker.handleUnsubscribe(client, data?.userIds);
  }

  @SubscribeMessage("conversation.join")
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!data?.conversationId) return;
    const allowed = await this.ensureConversationAccess(
      client,
      data.conversationId,
    );
    if (!allowed) {
      client.emit("conversation.error", {
        conversationId: data.conversationId,
        message: "Forbidden conversation access",
      });
      return;
    }
    const previousConversationId = client.data.activeConversationId as
      | string
      | undefined;
    if (
      previousConversationId &&
      previousConversationId !== data.conversationId
    ) {
      client.leave(`conversation:${previousConversationId}`);
    }
    await this.registerActiveConversation(client, data.conversationId);
    client.join(`conversation:${data.conversationId}`);
  }

  @SubscribeMessage("conversation.leave")
  async handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    if (!data?.conversationId) return;
    await this.clearActiveConversation(client, data.conversationId);
    client.leave(`conversation:${data.conversationId}`);
  }

  // ============= TYPING =============

  @SubscribeMessage("typing.start")
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.user?.id as string;
    if (!userId || !data?.conversationId) return;
    const allowed = await this.ensureConversationAccess(
      client,
      data.conversationId,
    );
    if (!allowed) return;
    this.broadcastToConversation(data.conversationId, "typing", {
      conversationId: data.conversationId,
      userId,
      isTyping: true,
    });
  }

  @SubscribeMessage("typing.stop")
  async handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.user?.id as string;
    if (!userId || !data?.conversationId) return;
    const allowed = await this.ensureConversationAccess(
      client,
      data.conversationId,
    );
    if (!allowed) return;
    this.broadcastToConversation(data.conversationId, "typing", {
      conversationId: data.conversationId,
      userId,
      isTyping: false,
    });
  }

  private broadcastToConversation(
    conversationId: string,
    event: string,
    payload: any,
  ) {
    this.server.to(`conversation:${conversationId}`).emit(event, payload);
  }
  broadcastNewMessage(msg: MessageResponseDTO) {
    this.broadcastToConversation(msg.conversationId, "message.new", msg);
    this.logger.debug(
      `Broadcasted new message ${msg._id} to conversation ${msg.conversationId}`,
    );
  }

  broadcastMessageUpdated(msg: MessageResponseDTO) {
    this.broadcastToConversation(msg.conversationId, "message.updated", msg);
  }

  broadcastMessageDeleted(msg: MessageResponseDTO) {
    this.broadcastToConversation(msg.conversationId, "message.deleted", msg);
  }

  broadcastReactionUpdated(msg: MessageResponseDTO) {
    this.broadcastToConversation(
      msg.conversationId,
      "message.reactionUpdated",
      msg,
    );
  }

  broadcastConversationRead(
    conversationId: string,
    userId: string,
    lastSeenMessageId: string | null,
  ) {
    this.broadcastToConversation(conversationId, "conversation.read", {
      conversationId,
      userId,
      lastSeenMessageId,
    });
  }

  private emitToUsers(userIds: string[], event: string, payload: any) {
    if (!userIds.length) return;
    this.server
      .to(userIds.map((userId) => `user:${userId}`))
      .emit(event, payload);
  }

  emitConversationCreated(conv: ConversationResponseDTO) {
    this.emitToUsers(conv.participants, "conversation.created", conv);
  }

  emitConversationUpdated(conv: ConversationResponseDTO) {
    const visibleUsers = this.getVisibleUsers(conv);
    this.emitToUsers(visibleUsers, "conversation.updated", conv);
  }

  emitConversationDeleted(convId: string, participants: string[]) {
    this.emitToUsers(participants, "conversation.deleted", { id: convId });
    void this.revokeConversationAccessForUsers(participants, convId);
  }

  emitConversationHidden(conversationId: string, userId: string) {
    this.server.to(`user:${userId}`).emit("conversation.hidden", {
      id: conversationId,
    });
    void this.revokeConversationAccessForUsers([userId], conversationId);
  }

  emitConversationUnhidden(
    conversation: ConversationResponseDTO,
    userId: string,
  ) {
    this.server
      .to(`user:${userId}`)
      .emit("conversation.unhidden", conversation);
  }

  emitMemberLeft(conversationId: string, participants: string[]) {
    this.emitToUsers(participants, "conversation.memberLeft", {
      conversationId,
    });
    void this.revokeConversationAccessForUsers(participants, conversationId);
    this.logger.debug(
      `Emitted memberLeft for conversation ${conversationId} to [${participants.join(", ")}]`,
    );
  }

  emitMemberJoined(
    conversation: ConversationResponseDTO,
    participants: string[],
  ) {
    this.emitToUsers(participants, "conversation.memberJoined", conversation);
  }

  emitCallCreated(payload: {
    conversationId: string;
    participants: string[];
    [key: string]: any;
  }) {
    this.emitToUsers(payload.participants || [], "call.invite", payload);
    if (payload.conversationId) {
      this.broadcastToConversation(
        payload.conversationId,
        "call.invite",
        payload,
      );
    }
  }

  emitCallAccepted(payload: {
    conversationId: string;
    participants?: string[];
    [key: string]: any;
  }) {
    this.emitToUsers(payload.participants || [], "call.accepted", payload);
    if (payload.conversationId) {
      this.broadcastToConversation(
        payload.conversationId,
        "call.accepted",
        payload,
      );
    }
  }

  emitCallRejected(payload: {
    conversationId: string;
    participants?: string[];
    [key: string]: any;
  }) {
    this.emitToUsers(payload.participants || [], "call.rejected", payload);
    if (payload.conversationId) {
      this.broadcastToConversation(
        payload.conversationId,
        "call.rejected",
        payload,
      );
    }
  }

  emitCallEnded(payload: {
    conversationId: string;
    participants?: string[];
    [key: string]: any;
  }) {
    this.emitToUsers(payload.participants || [], "call.ended", payload);
    if (payload.conversationId) {
      this.broadcastToConversation(
        payload.conversationId,
        "call.ended",
        payload,
      );
    }
  }

  emitCallParticipantJoined(payload: {
    conversationId: string;
    [key: string]: any;
  }) {
    if (payload.conversationId) {
      this.broadcastToConversation(
        payload.conversationId,
        "call.participantJoined",
        payload,
      );
    }
  }

  emitCallParticipantLeft(payload: {
    conversationId: string;
    [key: string]: any;
  }) {
    if (payload.conversationId) {
      this.broadcastToConversation(
        payload.conversationId,
        "call.participantLeft",
        payload,
      );
    }
  }

  emitCallParticipantKicked(payload: {
    conversationId: string;
    targetUserId?: string;
    [key: string]: any;
  }) {
    if (payload.targetUserId) {
      this.server
        .to(`user:${payload.targetUserId}`)
        .emit("call.participantKicked", payload);
    }
    if (payload.conversationId) {
      this.broadcastToConversation(
        payload.conversationId,
        "call.participantKicked",
        payload,
      );
    }
  }

  private getVisibleUsers(conv: ConversationResponseDTO): string[] {
    const participants = conv.participants ?? [];
    const hiddenFor = ((conv as any).hiddenFor ?? []) as string[];
    if (!hiddenFor.length) return participants;
    const hiddenSet = new Set(hiddenFor);
    return participants.filter((u) => !hiddenSet.has(u));
  }

  private getAuthorizedConversationIds(client: Socket): Set<string> {
    if (!(client.data.authorizedConversationIds instanceof Set)) {
      client.data.authorizedConversationIds = new Set<string>();
    }
    return client.data.authorizedConversationIds as Set<string>;
  }

  private async ensureConversationAccess(
    client: Socket,
    conversationId: string,
  ): Promise<boolean> {
    const userId = client.user?.id;
    if (!userId || !conversationId) return false;

    const authorizedConversationIds = this.getAuthorizedConversationIds(client);
    if (authorizedConversationIds.has(conversationId)) {
      return true;
    }

    try {
      await lastValueFrom(
        this.chatClient.send("getConversationById", {
          userId,
          conversationId,
        }),
      );
      authorizedConversationIds.add(conversationId);
      return true;
    } catch (error) {
      this.logger.warn(
        `Rejected conversation access userId=${userId} conversationId=${conversationId}: ${error.message}`,
      );
      return false;
    }
  }

  private async revokeConversationAccessForUsers(
    userIds: string[],
    conversationId: string,
  ) {
    if (!userIds.length || !conversationId) return;

    const sockets = await this.server
      .in(userIds.map((userId) => `user:${userId}`))
      .fetchSockets();

    for (const socket of sockets) {
      socket.leave(`conversation:${conversationId}`);
      const authorizedConversationIds = socket.data
        .authorizedConversationIds as Set<string> | undefined;
      authorizedConversationIds?.delete(conversationId);
    }
  }

  private async registerActiveConversation(
    client: Socket,
    conversationId: string,
  ) {
    const userId = client.user?.id;
    if (!userId || !conversationId) return;

    const previousConversationId = client.data.activeConversationId as
      | string
      | undefined;
    if (previousConversationId && previousConversationId !== conversationId) {
      await this.clearActiveConversation(client, previousConversationId);
    }

    const connKey = this.getActiveConversationConnKey(userId, client.id);
    const setKey = this.getActiveConversationUserKey(userId, conversationId);
    const pipeline = this.redis.pipeline();
    pipeline.set(
      connKey,
      conversationId,
      "EX",
      this.ACTIVE_CONVERSATION_TTL_SECONDS,
    );
    pipeline.sadd(setKey, client.id);
    pipeline.expire(setKey, this.ACTIVE_CONVERSATION_TTL_SECONDS);
    await pipeline.exec();

    client.data.activeConversationId = conversationId;
  }

  private async clearActiveConversation(
    client: Socket,
    conversationId?: string,
  ) {
    const userId = client.user?.id;
    if (!userId) return;

    const activeConversationId =
      conversationId ??
      (client.data.activeConversationId as string | undefined) ??
      (await this.redis.get(
        this.getActiveConversationConnKey(userId, client.id),
      ));

    const connKey = this.getActiveConversationConnKey(userId, client.id);
    const pipeline = this.redis.pipeline();
    pipeline.del(connKey);
    if (activeConversationId) {
      pipeline.srem(
        this.getActiveConversationUserKey(userId, activeConversationId),
        client.id,
      );
    }
    await pipeline.exec();

    if (
      !conversationId ||
      conversationId === client.data.activeConversationId
    ) {
      delete client.data.activeConversationId;
    }
  }

  private async refreshActiveConversation(client: Socket) {
    const userId = client.user?.id;
    const conversationId = client.data.activeConversationId as
      | string
      | undefined;
    if (!userId || !conversationId) return;

    const connKey = this.getActiveConversationConnKey(userId, client.id);
    const setKey = this.getActiveConversationUserKey(userId, conversationId);
    const pipeline = this.redis.pipeline();
    pipeline.set(
      connKey,
      conversationId,
      "EX",
      this.ACTIVE_CONVERSATION_TTL_SECONDS,
    );
    pipeline.sadd(setKey, client.id);
    pipeline.expire(setKey, this.ACTIVE_CONVERSATION_TTL_SECONDS);
    await pipeline.exec();
  }

  private getActiveConversationConnKey(userId: string, socketId: string) {
    return `chat:activeConv:conn:${userId}:${socketId}`;
  }

  private getActiveConversationUserKey(userId: string, conversationId: string) {
    return `chat:activeConv:user:${userId}:${conversationId}`;
  }
}
