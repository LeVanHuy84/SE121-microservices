// src/notification/notification.processor.ts
import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { NotificationService } from './notification.service';
import { Injectable } from '@nestjs/common';
import { ChatPushService } from './chat-push.service';
import {
  CHAT_PUSH_DELIVERY_JOB,
  LEGACY_REGULAR_NOTIFICATION_JOB,
  NOTIFICATION_QUEUE,
  REGULAR_NOTIFICATION_DELIVERY_JOB,
} from './notification.jobs';

@Processor(NOTIFICATION_QUEUE)
@Injectable()
export class NotificationProcessor {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly chatPushService: ChatPushService,
  ) {}

  @Process(LEGACY_REGULAR_NOTIFICATION_JOB)
  async handleLegacySend(job: Job<{ id: string }>) {
    await this.handleRegularNotificationJob(job);
  }

  @Process(REGULAR_NOTIFICATION_DELIVERY_JOB)
  async handleSend(job: Job<{ id: string }>) {
    await this.handleRegularNotificationJob(job);
  }

  @Process(CHAT_PUSH_DELIVERY_JOB)
  async handleChatPush(job: Job<{ sendChatPushDto: Parameters<ChatPushService['sendChatPush']>[0] }>) {
    await this.chatPushService.sendChatPush(job.data.sendChatPushDto);
  }

  private async handleRegularNotificationJob(job: Job<{ id: string }>) {
    const id = job.data.id;
    const notification = await this.notificationService.findById(id);
    if (!notification) return;
    await this.notificationService.publishToChannels(notification as any);
  }
}
