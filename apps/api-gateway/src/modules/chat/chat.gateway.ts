import { OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Inject, Logger } from '@nestjs/common';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ClientProxy } from '@nestjs/microservices';
import { Socket } from 'socket.io';
import { Send } from 'express';
import { SendMessageDTO } from '@repo/dtos';
import { firstValueFrom } from 'rxjs';

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

  private onlineUsers = new Map<string, string>();
  constructor(
    @Inject(MICROSERVICES_CLIENTS.CHAT_SERVICE)
    private readonly chatClient: ClientProxy
  ) {}
  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.onlineUsers.entries()) {
      if (socketId === client.id) {
        this.onlineUsers.delete(userId);
        this.logger.log(`User disconnected: ${userId}, socketId: ${client.id}`);
        break;
      }
    }
  }
  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;
    if (userId) {
      this.onlineUsers.set(userId, client.id);
      this.logger.log(`User connected: ${userId}, socketId: ${client.id}`);
    } else {
      client.disconnect();
      this.logger.warn(`Connection rejected: No userId provided, socketId: ${client.id}`);
    }
  }

  @SubscribeMessage('message.send')
  async handleMessageSend(
    client: Socket,
    payload: { conversationId: string; senderId: string; dto: SendMessageDTO },
  ) {
    try {
      const message = await firstValueFrom(
        this.chatClient.send('sendMessage', {
          conversationId: payload.conversationId,
          senderId: payload.senderId,
          dto: payload.dto,
        })
      ); 
      

      // Emit to sender
      client.emit('message.sent', message);

      // Emit to other participants if online
      // Here you would typically fetch the conversation participants from your service
      const participants = [payload.senderId]; // Replace with actual participant IDs

      for (const participantId of participants) {
        if (participantId !== payload.senderId && this.onlineUsers.has(participantId)) {
          const socketId = this.onlineUsers.get(participantId);
          if (socketId) {
            client.to(socketId).emit('message.received', message);
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
    payload: { messageId: string; userId: string },
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
    payload: { messageId: string; userId: string; emoji: string },
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
