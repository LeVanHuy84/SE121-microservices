import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';

export type NotificationSample = {
  id: string;
  eventType: string;
  payload: any;
};

@Injectable()
export class NotificationService {
  constructor(@Inject('NOTIFICATION_SERVICE') private client: ClientProxy) {
    console.log('🔥 NotificationService initialized');
  }

  async sendNotification(dto: NotificationSample) {
    const message = {
      createNotificationDto: {
        requestId: dto.id,
        userId: dto.payload?.userId,
        type: dto.eventType,
        payload: dto.payload,
        meta: {
          priority: 1,
          maxRetries: 3,
        },
      },
      timestamp: new Date().toISOString(),
    };

    await lastValueFrom(this.client.emit('create_notification', message));
  }
}
