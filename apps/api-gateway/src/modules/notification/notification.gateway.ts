import { Inject, Logger } from '@nestjs/common';
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
import type { ChannelWrapper } from 'amqp-connection-manager';
import * as amqp from 'amqplib';
import { firstValueFrom } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { NotificationResponseDto } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { clerkWsMiddleware } from 'src/common/middlewares/clerk-ws.middleware';
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: '*', // hoặc domain frontend
    methods: ['GET', 'POST'],
  },
  transports: ['websocket'],
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
      await channel.prefetch(100);
      const { queue } = await channel.assertQueue('', {
        exclusive: true,
        autoDelete: true,
        durable: false,
        arguments: {
          'x-dead-letter-exchange': 'dlx',
          'x-dead-letter-routing-key': 'notification_gateway',
        },
      });
      await channel.bindQueue(queue, 'notification', 'channel.*');
      await channel.consume(queue, async (msg) => {
        if (!msg) return;
        try {
          const payload = JSON.parse(
            msg.content.toString()
          ) as NotificationResponseDto;
          if (!payload?.userId) {
            this.logger.warn('Notification payload missing userId', payload);
            channel.ack(msg);
            return;
          }
          this.logger.log('Log payload', payload);
          this.server
            .to(`user-notif:${payload.userId}`)
            .emit('notification', payload);
          channel.ack(msg);
          this.logger.log(`Sent notification to user ${payload.userId}`);
        } catch (err) {
          this.logger.error('Failed to process notification', err);
          channel.nack(msg, false, false);
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
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('mark_read')
  async handleMarkAsRead(
    @MessageBody() id: string,
    @ConnectedSocket() client: Socket
  ) {
    try {
      const userId = client.user?.id;
      if (!userId) {
        this.logger.warn(`Client ${client.id} has no user ID`);
        return;
      }

      this.logger.log(`Marking notification ${id} as read`);
      const result = await firstValueFrom(
        this.notificationClient.send('mark_read', id)
      );

      console.log('result', result);
      this.server.to(`user-notif:${userId}`).emit('mark_read', id);
    } catch (err) {
      this.logger.error(`Failed to mark notification ${id} as read`, err);
      client.emit('mark_read_error', { id, error: err.message });
    }
  }

  @SubscribeMessage('mark_read_all')
  async handleMarkAllAsRead(@ConnectedSocket() client: Socket) {
    const userId = client.user?.id;

    try {
      if (!userId) {
        this.logger.warn(
          `Client ${client.id} has no authenticated user ID; cannot mark all as read`
        );
        client.emit('mark_read_all_error', { error: 'Unauthenticated' });
        return;
      }
      const result = await firstValueFrom(
        this.notificationClient.send('mark_read_all', userId)
      );
      console.log('result', result);
      this.server.to(`user-notif:${userId}`).emit('mark_read_all');
    } catch (err) {
      this.logger.error(
        `Failed to mark all notifications as read for user ${userId}`,
        err
      );
      client.emit('mark_read_all_error', { error: err.message });
    }
  }
}
