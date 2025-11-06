import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CreateNotificationDto } from '@repo/dtos';
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
    const createNotificationDto: CreateNotificationDto = {
      requestId: dto.id,
      userId: dto.payload?.userId,
      type: dto.eventType,
      payload: dto.payload,
      sendAt: new Date(),
      meta: {
        priority: 1,
        maxRetries: 3,
      },
    };

    const message = {
      createNotificationDto,
      origin: 'post-service',
    };

    await lastValueFrom(this.client.emit('create_notification', message));
  }
}
