import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ClearChatPushStateDto,
  CreateNotificationDto,
  SendCallPushDto,
  SendChatPushDto,
} from '@repo/dtos';
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

  async sendChatPush(sendChatPushDto: SendChatPushDto) {
    await lastValueFrom(this.client.emit('send_chat_push', { sendChatPushDto }));
  }

  async sendCallPush(sendCallPushDto: SendCallPushDto) {
    await lastValueFrom(this.client.emit('send_call_push', { sendCallPushDto }));
  }

  async sendCallCancelPush(data: {
    callId: string;
    conversationId: string;
    actorId: string;
    userId: string;
  }) {
    await lastValueFrom(this.client.emit('send_call_cancel_push', data));
  }

  async clearChatPushState(clearChatPushStateDto: ClearChatPushStateDto) {
    await lastValueFrom(
      this.client.emit('clear_chat_push_state', { clearChatPushStateDto }),
    );
  }
}
