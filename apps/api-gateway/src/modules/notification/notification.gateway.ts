import { Inject, Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { ChannelWrapper } from 'amqp-connection-manager';
import { Server, Socket } from 'socket.io';
@WebSocketGateway({
  namespace: '/api/v1/notifications',
  cors: {
    origin: '*', // hoặc domain frontend
    methods: ['GET', 'POST'],
  },
  transport : ['websocket'],
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
    this.rabbitChannel.addSetup(async (channel) => {
      await channel.consume('notification_queue', async (msg: any) => {
        if (!msg) return;
        try {
          const payload = JSON.parse(msg.content.toString());
          this.io.to(`user-notification:${payload.userId}`).emit('notification', payload);
          channel.ack(msg);
          this.logger.log(`Sent notification to user ${payload.userId}`);
        } catch (err) {
          this.logger.error('Failed to process notification', err);
          channel.nack(msg, false, true);
        }
      });
    });
  }
  handleConnection(client: any, ...args: any[]) {
    this.logger.log(`Client connected: ${client.id}`);
  }
  handleDisconnect(client: any) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket
  ) {
    client.join(`user-notification:${data.userId}`);
    console.log(`Client ${client.id} joined room user:${data.userId}`);
  }
}
