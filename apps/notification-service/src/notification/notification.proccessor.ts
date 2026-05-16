// src/notification/notification.processor.ts
import { Processor, Process } from '@nestjs/bull';
import type { Job } from 'bull';
import { NotificationService } from './notification.service';
import { Injectable, Logger } from '@nestjs/common';
import { ChatPushService } from './chat-push.service';
import {
  CALL_PUSH_DELIVERY_JOB,
  CHAT_PUSH_DELIVERY_JOB,
  LEGACY_REGULAR_NOTIFICATION_JOB,
  NOTIFICATION_QUEUE,
  REGULAR_NOTIFICATION_DELIVERY_JOB,
} from './notification.jobs';
import {
  isRetryableDeliveryError,
  NotificationDeliveryError,
} from './notification-delivery.error';

@Processor(NOTIFICATION_QUEUE)
@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

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

  @Process(CALL_PUSH_DELIVERY_JOB)
  async handleCallPush(job: Job<{ sendCallPushDto: Parameters<ChatPushService['sendCallPush']>[0] }>) {
    try {
      await this.chatPushService.sendCallPush(job.data.sendCallPushDto);
    } catch (error) {
      this.handleDeliveryError(job, error);
    }
  }

  @Process(CALL_CANCEL_PUSH_DELIVERY_JOB)
  async handleCallCancelPush(job: Job<{ callId: string; conversationId: string; actorId: string; userId: string }>) {
    try {
      await this.chatPushService.sendCallCancelPush(job.data);
    } catch (error) {
      this.handleDeliveryError(job, error);
    }
  }

  private async handleRegularNotificationJob(job: Job<{ id: string }>) {

    try {
      const id = job.data.id;
      const notification = await this.notificationService.findById(id);
      if (!notification) return;
      await this.notificationService.publishToChannels(notification as any);
    } catch (error) {
      this.handleDeliveryError(job, error);
    }
  }

  private handleDeliveryError(job: Job, error: unknown): never | void {
    if (isRetryableDeliveryError(error)) {
      throw error;
    }

    if (error instanceof NotificationDeliveryError) {
      this.logger.warn(
        `Skip retry for job ${job.name} (${job.id ?? 'unknown'}): ${error.message}`,
      );
      return;
    }

    throw error;
  }
}
