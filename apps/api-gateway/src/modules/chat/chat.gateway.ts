import { InjectRedis } from '@nestjs-modules/ioredis';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { PresenceUpdateEvent } from '@repo/dtos';
import { ConversationResponseDTO, MessageResponseDTO } from '@repo/dtos';
import Redis from 'ioredis';
import { Server, Socket } from 'socket.io';
import { clerkWsMiddleware } from 'src/common/middlewares/clerk-ws.middleware';

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: '*',
  },
  transport: ['websocket'],
})
export class ChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(ChatGateway.name);
  private sub: Redis;
  @WebSocketServer() server: Server;

  private serverId = `${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async onModuleInit() {
    this.sub = this.redis.duplicate();

    await this.sub.subscribe('presence:updates');
    this.sub.on('message', (channel, message) => {
      if (channel !== 'presence:updates') return;
      this.handlePresenceUpdateMessage(message);
    });

    this.logger.log('PresenceGateway subscribed to presence:updates');
  }

  async onModuleDestroy() {
    if (this.sub) {
      this.sub.removeAllListeners();
      this.sub.disconnect();
    }
  }

  afterInit(server: Server) {
    server.use(clerkWsMiddleware);
    this.logger.log('✅ WS Gateway initialized');
  }

  async handleConnection(client: Socket) {
    const userId = client.user?.id;
    if (!userId) {
      this.logger.warn('❌ Unauthorized client tried to connect');
      client.disconnect(true);
      return;
    }

    client.join(`user:${userId}`);

    this.logger.log(`✅ Client connected: ${userId}`);
  }
  async handleDisconnect(client: Socket) {
    this.logger.log(`❌ Client disconnected: ${client.user?.id}`);
  }

  // ========== Client subscribe / unsubscribe presence của người khác ==========

  @SubscribeMessage('presence.subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userIds: string[] }
  ) {
    const { userIds } = data || {};
    if (!Array.isArray(userIds) || !userIds.length) return;

    userIds.forEach((id) => client.join(`presence:${id}`));
    this.logger.debug(
      `Client ${client.id} subscribed presence of [${userIds.join(', ')}]`
    );
  }

  @SubscribeMessage('presence.unsubscribe')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userIds: string[] }
  ) {
    const { userIds } = data || {};
    if (!Array.isArray(userIds) || !userIds.length) return;

    userIds.forEach((id) => client.leave(`presence:${id}`));
    this.logger.debug(
      `Client ${client.id} unsubscribed presence of [${userIds.join(', ')}]`
    );
  }

  @SubscribeMessage('conversation.join')
  handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string }
  ) {
    client.join(`conversation:${data.conversationId}`);
  }

  @SubscribeMessage('conversation.leave')
  handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string }
  ) {
    client.leave(`conversation:${data.conversationId}`);
  }

  // ============= TYPING =============

  @SubscribeMessage('typing.start')
  handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string }
  ) {
    const userId = client.user?.id as string;
    if (!userId) return;
    this.broadcastToConversation(data.conversationId, 'typing', {
      conversationId: data.conversationId,
      userId,
      isTyping: true,
    });
  }

  @SubscribeMessage('typing.stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string }
  ) {
    const userId = client.user?.id as string;
    if (!userId) return;
    this.broadcastToConversation(data.conversationId, 'typing', {
      conversationId: data.conversationId,
      userId,
      isTyping: false,
    });
  }

  private broadcastToConversation(
    conversationId: string,
    event: string,
    payload: any
  ) {
    this.server.to(`conversation:${conversationId}`).emit(event, payload);
  }
  broadcastNewMessage(msg: MessageResponseDTO) {
    this.broadcastToConversation(msg.conversationId, 'message.new', msg);
  }

  broadcastMessageUpdated(msg: MessageResponseDTO) {
    this.broadcastToConversation(msg.conversationId, 'message.updated', msg);
  }

  broadcastMessageDeleted(msg: MessageResponseDTO) {
    this.broadcastToConversation(msg.conversationId, 'message.deleted', msg);
  }

  broadcastReactionUpdated(msg: MessageResponseDTO) {
    this.broadcastToConversation(
      msg.conversationId,
      'message.reactionUpdated',
      msg
    );
  }

  broadcastConversationRead(
    conversationId: string,
    userId: string,
    lastSeenMessageId: string | null
  ) {
    this.broadcastToConversation(conversationId, 'conversation.read', {
      conversationId,
      userId,
      lastSeenMessageId,
    });
  }

  private emitToUsers(userIds: string[], event: string, payload: any) {
    userIds.forEach((userId) => {
      this.server.to(`user:${userId}`).emit(event, payload);
    });
  }

  emitConversationCreated(conv: ConversationResponseDTO) {
    this.emitToUsers(conv.participants, 'conversation.created', conv);
  }

  emitConversationUpdated(conv: ConversationResponseDTO) {
    this.emitToUsers(conv.participants, 'conversation.updated', conv);
  }

  emitConversationDeleted(convId: string, participants: string[]) {
    this.emitToUsers(participants, 'conversation.deleted', { id: convId });
  }

  emitConversationHidden(convId: string, userId: string) {
    this.server
      .to(`user:${userId}`)
      .emit('conversation.hidden', { id: convId });
  }

  emitConversationUnhidden(conv: ConversationResponseDTO, userId: string) {
    this.server.to(`user:${userId}`).emit('conversation.unhidden', conv);
  }

  emitMemberLeft(
    conversationId: string,
    userId: string,
    participants: string[]
  ) {
    this.emitToUsers(participants, 'conversation.memberLeft', {
      conversationId,
      userId,
    });
  }

  emitMemberJoined(
    conversationId: string,
    userId: string,
    participants: string[]
  ) {
    this.emitToUsers(participants, 'conversation.memberJoined', {
      conversationId,
      userId,
    });
  }

  // ========== Handle presence update từ presence-service ==========
  private handlePresenceUpdateMessage(message: string) {
    let evt: PresenceUpdateEvent;
    try {
      evt = JSON.parse(message);
    } catch (e) {
      this.logger.error('Invalid presence update message', e);
      return;
    }

    if (evt.type !== 'PRESENCE_UPDATE') return;

    // Broadcast cho tất cả client đang subscribe presence của user này
    this.server.to(`presence:${evt.userId}`).emit('presence.update', {
      userId: evt.userId,
      status: evt.status,
      lastSeen: evt.lastSeen,
    });
  }
}
