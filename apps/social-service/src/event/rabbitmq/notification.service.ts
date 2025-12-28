import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CreateNotificationDto, NotificationPayload } from '@repo/dtos';
import { lastValueFrom } from 'rxjs';

export type NotificationSample = {
  id: string;
  eventType: string;
  payload: NotificationPayload;
};

@Injectable()
export class NotificationService {
  constructor(@Inject('NOTIFICATION_SERVICE') private client: ClientProxy) {
    console.log('🔥 NotificationService initialized');
  }

  async sendNotification(dto: NotificationSample) {
    const createNotificationDto: CreateNotificationDto = {
      requestId: dto.id,
      userId: dto.payload?.targetId,
      type: dto.eventType,
      payload: dto.payload,
      sendAt: new Date(),
      meta: {
        priority: 1,
        maxRetries: 3,
      },
      channels: []
    };

    const message = {
      createNotificationDto,
      origin: 'social-service',
    };

    await lastValueFrom(this.client.emit('create_notification', message));
  }
}
