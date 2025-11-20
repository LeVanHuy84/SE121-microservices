import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
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
import { RedisPubSubService } from '@repo/common';
import {
  ConversationResponseDTO,
  CreateConversationDTO,
  SendMessageDTO,
} from '@repo/dtos';
import * as kafkajs from 'kafkajs';
import { firstValueFrom } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { clerkWsMiddleware } from 'src/common/middlewares/clerk-ws.middleware';

const CMDS = {
  CONNECT: 'chat_gateway.connect',
  HEARTBEAT: 'chat_gateway.heartbeat',
  DISCONNECT: 'chat_gateway.disconnect',
};
const EVENTS = {
  ONLINE: 'presence.online',
  OFFLINE: 'presence.offline',
  MESSAGE_STORED: 'chat:message.stored',
  MESSAGE_STATUS_UPDATED: 'chat:message.status.updated',
  CONVERSATION_CREATED: 'chat:conversation.created',
  CONVERSATION_UPDATED: 'chat:conversation.updated',
  ERROR: 'chat:error',
};
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
  @WebSocketServer() server: Server;

  private serverId = `${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  constructor(
    @Inject('REDIS_CHAT_GATEWAY') private readonly redis: RedisPubSubService,
    @Inject('KAFKA_PRODUCER') private readonly kafkaProducer: kafkajs.Producer,
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE)
    private readonly chatClient: ClientProxy
  ) {}

  async onModuleInit() {
    await Promise.all([
      this.redis.subscribe(EVENTS.ONLINE, (raw) => this.handleOnline(raw)),
      this.redis.subscribe(EVENTS.OFFLINE, (raw) => this.handleOffline(raw)),
      this.redis.subscribe(EVENTS.MESSAGE_STORED, (raw) =>
        this.onMessageStored(raw)
      ),
      this.redis.subscribe(EVENTS.MESSAGE_STATUS_UPDATED, (raw) =>
        this.onStatusUpdated(raw)
      ),
      this.redis.subscribe(EVENTS.CONVERSATION_CREATED, (raw) =>
        this.onConversationCreated(raw)
      ),
      this.redis.subscribe(EVENTS.CONVERSATION_UPDATED, (raw) =>
        this.onConversationUpdated(raw)
      ),
      this.redis.subscribe(EVENTS.ERROR, (raw) => {
        this.onHandleError(raw);
      }),
    ]);
    await this.ensureInboxGroup();
    this.startInboxLoop();
  }

  async onModuleDestroy() {
    await Promise.all([
      this.redis.unsubscribe(EVENTS.ONLINE),
      this.redis.unsubscribe(EVENTS.OFFLINE),
      this.redis.unsubscribe(EVENTS.MESSAGE_STORED),
      this.redis.unsubscribe(EVENTS.MESSAGE_STATUS_UPDATED),
      this.redis.unsubscribe(EVENTS.CONVERSATION_CREATED),
      this.redis.unsubscribe(EVENTS.CONVERSATION_UPDATED),
      this.redis.unsubscribe(EVENTS.ERROR),
    ]);
    this.logger.log('✅ Unsubscribed from presence channels via Redis');
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
    this.logger.log(`User connected: ${userId}`);

    const now = Date.now();
    this.redis
      .publish(
        CMDS.CONNECT,
        JSON.stringify({
          userId,
          serverId: this.serverId,
          socketId: client.id,
          now,
        })
      )
      .catch((e) => this.logger.error('publish connect failed', e));

    this.logger.log(`✅ Client connected: ${userId}`);
  }
  async handleDisconnect(client: Socket) {
    const userId = client.user?.id;
    if (!userId) return;

    const now = Date.now();
    this.redis
      .publish(
        CMDS.DISCONNECT,
        JSON.stringify({
          userId,
          serverId: this.serverId,
          socketId: client.id,
          now,
        })
      )
      .catch((e) => this.logger.error('publish disconnect failed', e));
    this.logger.log(`✅ Client disconnected: ${userId}`);

    client.leave(`user:${userId}`);
    this.logger.log(`User disconnected: ${userId}`);
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.user?.id;
    if (!userId) return;
    const now = Date.now();
    await this.redis.publish(CMDS.HEARTBEAT, JSON.stringify({ userId, now }));
  }

  @SubscribeMessage('join_conversation')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string }
  ) {
    const userId = client.user?.id;
    const ok = await firstValueFrom(
      this.chatClient.send('isParticipant', {
        conversationId: payload.conversationId,
        userId,
      })
    );
    if (!ok)
      return this.server
        .to(`user:${userId}`)
        .emit('error', { code: 'not_member' });

    client.join(`conversation:${payload.conversationId}`);

    await this.kafkaProducer.send({
      topic: 'chat_gateway.conversation.read',
      messages: [
        {
          key: payload.conversationId,
          value: JSON.stringify({
            conversationId: payload.conversationId,
            userId,
            timestamp: Date.now(),
          }),
        },
      ],
    });
    this.logger.debug(
      `User ${userId} joined conversation ${payload.conversationId}`
    );
  }

  @SubscribeMessage('create_conversation')
  async onCreateConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    dto: CreateConversationDTO
  ) {
    const userId = client.user?.id;
    await this.redis.publish(
      'chat_gateway:create_conversation',
      JSON.stringify({ creatorId: userId, dto })
    );
  }

  @SubscribeMessage('send_message')
  async onSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: SendMessageDTO
  ) {
    const userId = client.user?.id;
    await this.redis.publish(
      'chat_gateway:send_message',
      JSON.stringify({ senderId: userId, dto })
    );
  }

  @SubscribeMessage('read_message')
  async onRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string; messageId: string }
  ) {
    const userId = client.user?.id;
    await this.kafkaProducer.send({
      topic: 'chat_gateway.message.read',
      messages: [
        {
          key: payload.conversationId,
          value: JSON.stringify({
            messageId: payload.messageId,
            seenBy: userId,
            timestamp: Date.now(),
          }),
        },
      ],
    });
    this.logger.debug(
      `Sent read receipt for message ${payload.messageId} by user ${userId}`
    );
  }

  @SubscribeMessage('delete_message')
  async onDelete(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { messageId: string; conversationId: string }
  ) {
    const userId = client.user?.id;
    await this.redis.publish(
      'chat_gateway:delete_message',
      JSON.stringify({
        deleterId: userId,
        messageId: payload.messageId,
        conversationId: payload.conversationId,
      })
    );
  }

  // ================= PRESENCE EVENTS =================
  private handleOnline(raw: string) {
    try {
      const p = JSON.parse(raw);
      const { userId, lastActive, serverId, timestamp } = p;

      this.logger.debug(`Handling presence.online for user ${userId}`);
      // Emit to user's sockets so FE updates presence; optionally emit to contacts
      this.server.emit('user_online', {
        userId,
        lastActive,
        serverId,
        timestamp,
      });
      this.logger.debug(`Emitted user_online for ${userId}`);
    } catch (err) {
      this.logger.warn('invalid presence.online payload', err);
    }
  }

  private handleOffline(raw: string) {
    try {
      const p = JSON.parse(raw);
      const { userId, lastActive, serverId, reason, timestamp } = p;
      this.server.emit('user_offline', {
        userId,
        lastActive,
        serverId,
        reason,
        timestamp,
      });
      this.logger.debug(`Emitted user_offline for ${userId}`);
    } catch (err) {
      this.logger.warn('invalid presence.offline payload', err);
    }
  }

  private onMessageStored(raw: string) {
    const { conversationId, message } = JSON.parse(raw);
    this.server
      .to(`conversation:${conversationId}`)
      .emit('message:new', message);
  }

  private onStatusUpdated(raw: string) {
    const data = JSON.parse(raw) as {
      conversationId: string;
      messageId: string;
      update: 'seen' | 'deleted' | 'delivered';
      userId: string;
      timestamp: Date;
    };
    this.logger.debug(
      `Processing message status update: ${data.update} for message ${data.messageId}`,
      data
    );
    if (data.update === 'seen') {
      this.server
        .to(`conversation:${data.conversationId}`)
        .emit('message:seen', {
          messageId: data.messageId,
          seenBy: data.userId,
          timestamp: data.timestamp,
        });
      this.logger.debug(`Emitted message:seen for ${data.messageId}`);
    } else if (data.update === 'deleted') {
      this.server
        .to(`conversation:${data.conversationId}`)
        .emit('message:deleted', {
          message: data.messageId,
          userId: data.userId,
          timestamp: data.timestamp,
        });
      this.logger.debug(`Emitted message:deleted for ${data.messageId}`);
    } else if (data.update === 'delivered') {
      this.server
        .to(`conversation:${data.conversationId}`)
        .emit('message:delivered', {
          messageId: data.messageId,
          deliveredBy: data.userId,
          timestamp: data.timestamp,
        });
      this.logger.debug(`Emitted message:delivered for ${data.messageId}`);
    }
    this.logger.debug(`Emitted message:${data.update} for ${data.messageId}`);
  }

  private onConversationCreated(raw: string) {
    const converastion = JSON.parse(raw) as ConversationResponseDTO;
    for (const uid of converastion.participants) {
      this.server.to(`user:${uid}`).emit('conversation:new', converastion);
      this.logger.debug(`Emitted conversation:new to user ${uid}`);
    }
  }

  private onConversationUpdated(raw: string) {
    const data = JSON.parse(raw) as ConversationResponseDTO;
    for (const uid of data.participants) {
      this.server.to(`user:${uid}`).emit('conversation:update', data);
      this.logger.debug(`Emitted conversation:update to user ${uid}`);
    }
  }

  private async ensureInboxGroup() {
    await this.redis.baseClient
      .xgroup('CREATE', 'server.inbox', 'server_inbox_group', '$', 'MKSTREAM')
      .catch(() => {});

      this.logger.log('✅ Ensured inbox consumer group exists');
  }

  private startInboxLoop() {
    const stream = 'server.inbox';
    const group = 'server_inbox_group';
    const consumer = `srv_${this.serverId}`;
    (async () => {
      while (true) {
        try {
          const res: any = await this.redis.baseClient.xreadgroup(
            'GROUP',
            group,
            consumer,
            'STREAMS',
            stream,
            '>',
            'COUNT',
            16,
            'BLOCK',
            2000
          );
          if (!res) continue;
          for (const [, messages] of res) {
            for (const [id, kv] of messages) {
              const obj: any = {};
              for (let i = 0; i < kv.length; i += 2) obj[kv[i]] = kv[i + 1];
              const { type, payload } = obj;
              try {
                if (type === 'deliver_batch') {
                  const { toUserIds, message } = JSON.parse(payload);
                  for (const uid of toUserIds) {
                    // this.server.to(`user:${uid}`).emit('message:new', message);

                    await this.kafkaProducer.send({
                      topic:
                        process.env.KAFKA_TOPIC_DELIVER ||
                        'chat_gateway.message.delivery',
                      messages: [
                        {
                          key: message.messageId,
                          value: JSON.stringify({
                            messageId: message.messageId,
                            deliveredBy: uid,
                            timestamp: Date.now(),
                          }),
                        },
                      ],
                    });
                    this.logger.debug(
                      `Emitted message:new to user ${uid} from inbox`
                    );
                  }
                }
              } finally {
                await this.redis.baseClient.xack(stream, group, id);
              }
            }
          }
        } catch (err) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    })();
  }

  private onHandleError(raw: string) {
    const { userId, code } = JSON.parse(raw);
    this.server.to(`user:${userId}`).emit('error', { code });
    this.logger.debug(`Emitted error to user ${userId}: ${code}`);
  }
}
