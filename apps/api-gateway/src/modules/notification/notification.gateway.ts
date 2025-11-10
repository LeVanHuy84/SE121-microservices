import { Inject, Logger } from '@nestjs/common';
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
import type { ChannelWrapper } from 'amqp-connection-manager';
import { Server, Socket } from 'socket.io';
import { clerkWsMiddleware } from 'src/common/middlewares/clerk-ws.middleware';
import * as amqp from 'amqplib';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { Client } from '@clerk/backend';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: '*', // hoặc domain frontend
    methods: ['GET', 'POST'],
  },
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationGateway.name);
  constructor(
    @Inject('RABBITMQ_CHANNEL') private readonly rabbitChannel: ChannelWrapper,
    @Inject(MICROSERVICES_CLIENTS.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy
  ) {}
  @WebSocketServer() server: Server;
  afterInit(server: Server) {
    server.use(clerkWsMiddleware);
    this.logger.log('NotificationGateway initialized');
    this.rabbitChannel.addSetup(async (channel: amqp.Channel) => {
      await channel.consume('notification_queue', async (msg) => {
        if (!msg) return;
        try {
          const payload = JSON.parse(msg.content.toString());
          this.server
            .to(`user-notif:${payload.userId}`)
            .emit('notification', payload);
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
    this.logger.log(`Client connected: ${client.id}`);
    const userId = client.user?.id;
    if (userId) {
      client.join(`user-notif:${userId}`);
      this.logger.log(`Client ${client.id} joined room user-notif:${userId}`);
    } else {
      this.logger.warn(
        `Client ${client.id} has no authenticated user ID; disconnecting`
      );
      client.disconnect();
    }
  }
  handleDisconnect(client: Socket) {
    client.disconnect();
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('mark_read')
  async handleMarkAsRead(
    @MessageBody() id: string,
    @ConnectedSocket() client: Socket
  ) {
    try {
      const result = await firstValueFrom(
        this.notificationClient.send('mark_read', id)
      );

      console.log('result', result);
      client.emit('mark_read_success', { id });
    } catch (err) {
      this.logger.error(`Failed to mark notification ${id} as read`, err);
      client.emit('mark_read_error', { id, error: err.message });
    }
  }

  @SubscribeMessage('mark_read_all')
  async handleMarkAllAsRead(@ConnectedSocket() client: Socket) {
    const userId = client.user?.id;
    if (!userId) {
      this.logger.warn(
        `Client ${client.id} has no authenticated user ID; cannot mark all as read`
      );
      client.emit('mark_read_all_error', { error: 'Unauthenticated' });
      return;
    }
    try {
      const result = await firstValueFrom(
        this.notificationClient.send('mark_read_all', userId)
      );
      console.log('result', result);
      client.emit('mark_read_all_success');
    } catch (err) {
      this.logger.error(
        `Failed to mark all notifications as read for user ${userId}`,
        err
      );
      client.emit('mark_read_all_error', { error: err.message });
    }
  }
}
