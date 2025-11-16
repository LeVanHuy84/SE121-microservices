import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CreateNotificationDto } from '@repo/dtos';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class NotificationService {
  constructor(@Inject('NOTIFICATION_SERVICE') private client: ClientProxy) {
    console.log('🔥 NotificationService initialized');
  }

  async sendNotification(
    createNotificationDto: CreateNotificationDto
    // origin: string
  ) {
    // const message = {
    //   createNotificationDto,
    //   origin,
    // };

    await lastValueFrom(
      this.client.emit('create_notification', { createNotificationDto })
    );
  }
}
