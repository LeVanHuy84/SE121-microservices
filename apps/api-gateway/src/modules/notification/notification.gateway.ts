import { Inject, Logger, UseGuards } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { ChannelWrapper } from 'amqp-connection-manager';
import * as amqp from 'amqplib';
import { Server, Socket } from 'socket.io';
import { ClerkWsGuard } from '../auth/clerk-auth-ws.guard';
import { ChannelNotification } from '@repo/dtos';
@UseGuards(ClerkWsGuard)
@WebSocketGateway({
  namespace: '/api/v1/notifications',
  cors: {
    origin: '*', // hoặc domain frontend
    methods: ['GET', 'POST'],
  },
  transport: ['websocket'],
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationGateway.name);
  constructor(
    @Inject('RABBITMQ_CHANNEL') private readonly rabbitChannel: ChannelWrapper
  ) {}
  @WebSocketServer() io: Server;
  afterInit(server: Server) {
    this.logger.log('NotificationGateway initialized');
    this.rabbitChannel.addSetup(async (channel: amqp.Channel) => {
      await channel.consume('notification_queue', async (msg) => {
        if (!msg) return;
        try {
          const payload = JSON.parse(msg.content.toString());
          const routingKey = msg.fields.routingKey;
          if (routingKey === `channel.${ChannelNotification.WEBSOCKET}`) {
            this.io
              .to(`user-notification:${payload.userId}`)
              .emit('notification', payload);
          }
          channel.ack(msg);
          this.logger.log(`Sent notification to user ${payload.userId}`);
        } catch (err) {
          this.logger.error('Failed to process notification', err);
          channel.nack(msg, false, true);
        }
      });
    });
  }
  handleConnection(client: Socket) {
    const user = client.data.user;
    if (!user) {
      this.logger.warn(`Unauthorized client tried to connect: ${client.id}`);
      client.disconnect();
      return;
    }
    const room = `user-notification:${user.userId}`;
    client.join(room);
    this.logger.log(`Client connected: ${client.id}, joined room: ${room}`);
  }
  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
}
