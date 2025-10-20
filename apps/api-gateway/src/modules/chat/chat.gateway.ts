import { Inject, Logger, UseGuards } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { SendMessageDTO } from '@repo/dtos';
import { firstValueFrom } from 'rxjs';
import { Socket } from 'socket.io';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ClerkWsGuard } from '../auth/clerk-auth-ws.guard';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@UseGuards(ClerkWsGuard)
@WebSocketGateway({
  namespace: '/api/v1/chat',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transport: ['websocket'],
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE)
    private readonly chatClient: ClientProxy,
    @InjectRedis() private readonly redis: Redis
  ) {}

  async handleConnection(client: Socket) {
    const user = client.data.user;
    if (!user) {
      this.logger.warn(`Unauthorized client tried to connect: ${client.id}`);
      client.disconnect();
      return;
    }
    // Store mapping of userId to socketId in Redis
    await this.redis.hset('onlineUsers', user.userId, client.id);
    client.join(`user-chat:${user.userId}`);
    this.logger.log(`Client connected: ${client.id} for user: ${user.userId}`);


  }
  async handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (user) {
      // Remove mapping of userId to socketId from Redis
      await this.redis.hdel('onlineUsers', user.userId);
      this.logger.log(`Client disconnected: ${client.id} for user: ${user.userId}`);
    } else {
      this.logger.log(`Client disconnected: ${client.id}`);
    }
  }

  @SubscribeMessage('message.send')
  async handleMessageSend(
    client: Socket,
    payload: { conversationId: string; senderId: string; dto: SendMessageDTO }
  ) {
    try {
      const message = await firstValueFrom(
        this.chatClient.send('createMessage', {
          conversationId: payload.conversationId,
          senderId: payload.senderId,
          dto: payload.dto,
        })
      );
      
      // Notify all participants in the conversation about the new message
      const participants = await firstValueFrom(
        this.chatClient.send('getParticipantInConversation', {
          conversationId: payload.conversationId,
        })
      ); 
      for (const participantId of participants) {
        if (await this.redis.hexists('onlineUsers', participantId)) {
          const socketId = await this.redis.hget('onlineUsers', participantId);
          if (socketId) {
            client.to(socketId).emit('message.new', message);
          }
        }
    }

    } catch (error) {
      this.logger.error('Error handling message.send', error);
      client.emit('message.error', { error: 'Failed to send message' });
    }
      
  }

  // @SubscribeMessage('message.typing')
  // handleMessageTyping(
  //   client: Socket,
  //   payload: { conversationId: string; userId: string; isTyping: boolean },
  // ) {
  //   // Broadcast typing indicator to other participants
  //   const participants = [payload.userId]; // Replace with actual participant IDs

  //   for (const participantId of participants) {
  //     if (participantId !== payload.userId && this.onlineUsers.has(participantId)) {
  //       const socketId = this.onlineUsers.get(participantId);
  //       if (socketId) {
  //         client.to(socketId).emit('message.typing', {
  //           conversationId: payload.conversationId,
  //           userId: payload.userId,
  //           isTyping: payload.isTyping,
  //         });
  //       }
  //     }
  //   }
  // }

  @SubscribeMessage('message.seen')
  async handleMessageSeen(
    client: Socket,
    payload: { messageId: string; userId: string }
  ) {
    try {
      const message = await firstValueFrom(
        this.chatClient.send('markMessageAsRead', {
          messageId: payload.messageId,
          userId: payload.userId,
        })
      );

      // Notify the sender that the message has been seen
      const senderId = message.senderId;
      if (this.onlineUsers.has(senderId)) {
        const socketId = this.onlineUsers.get(senderId);
        if (socketId) {
          client.to(socketId).emit('message.seen', {
            messageId: payload.messageId,
            userId: payload.userId,
          });
        }
      }
    } catch (error) {
      this.logger.error('Error handling message.seen', error);
    }
  }

  @SubscribeMessage('message.react')
  async handleMessageReact(
    client: Socket,
    payload: { messageId: string; userId: string; emoji: string }
  ) {
    try {
      const message = await firstValueFrom(
        this.chatClient.send('reactMessage', {
          messageId: payload.messageId,
          userId: payload.userId,
          emoji: payload.emoji,
        })
      );

      // Notify the sender about the reaction
      const senderId = message.senderId;
      if (this.onlineUsers.has(senderId)) {
        const socketId = this.onlineUsers.get(senderId);
        if (socketId) {
          client.to(socketId).emit('message.reacted', {
            messageId: payload.messageId,
            userId: payload.userId,
            emoji: payload.emoji,
          });
        }
      }
    } catch (error) {
      this.logger.error('Error handling message.react', error);
      client.emit('message.error', { error: 'Failed to react to message' });
    }
  }
}
