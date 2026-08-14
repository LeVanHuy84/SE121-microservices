// src/notification/notification.processor.ts
import { Processor, Process, OnQueueFailed, OnQueueError } from "@nestjs/bull";
import type { Job } from "bull";
import { NotificationService } from "./notification.service";
import { Injectable, Logger } from "@nestjs/common";
import { ChatPushService } from "./chat-push.service";
import { NotificationDispatcherService } from "./services/notification-dispatcher.service";
import {
  CALL_CANCEL_PUSH_DELIVERY_JOB,
  CALL_PUSH_DELIVERY_JOB,
  CHAT_PUSH_DELIVERY_JOB,
  NOTIFICATION_QUEUE,
  REGULAR_NOTIFICATION_DELIVERY_JOB,
} from "./notification.jobs";
import {
  isRetryableDeliveryError,
  NotificationDeliveryError,
} from "./notification-delivery.error";

@Processor(NOTIFICATION_QUEUE)
@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly dispatcherService: NotificationDispatcherService,
    private readonly chatPushService: ChatPushService,
  ) {}

  @Process(REGULAR_NOTIFICATION_DELIVERY_JOB)
  async handleSend(job: Job<{ id: string }>) {
    await this.handleRegularNotificationJob(job);
  }

  @Process(CHAT_PUSH_DELIVERY_JOB)
  async handleChatPush(
    job: Job<{
      sendChatPushDto: Parameters<ChatPushService["sendChatPush"]>[0];
    }>,
  ) {
    try {
      await this.chatPushService.sendChatPush(job.data.sendChatPushDto);
    } catch (error) {
      this.handleDeliveryError(job, error);
    }
  }

  @Process(CALL_PUSH_DELIVERY_JOB)
  async handleCallPush(
    job: Job<{
      sendCallPushDto: Parameters<ChatPushService["sendCallPush"]>[0];
    }>,
  ) {
    try {
      await this.chatPushService.sendCallPush(job.data.sendCallPushDto);
    } catch (error) {
      this.handleDeliveryError(job, error);
    }
  }

  @Process(CALL_CANCEL_PUSH_DELIVERY_JOB)
  async handleCallCancelPush(
    job: Job<{
      callId: string;
      conversationId: string;
      actorId: string;
      userId: string;
    }>,
  ) {
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
      await this.dispatcherService.publishToChannels(notification as any);
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
        `Skip retry for job ${job.name} (${job.id ?? "unknown"}): ${error.message}`,
      );
      return;
    }

    throw error;
  }

  @OnQueueFailed()
  onJobFailed(job: Job, err: Error) {
    this.logger.error(
      `🚨 Job ${job.name} (ID: ${job.id}) đã thất bại hoàn toàn sau ${job.attemptsMade} lần thử.`,
      err.stack,
    );
  }

  @OnQueueError()
  onQueueError(error: Error) {
    this.logger.error(`🔥 Lỗi từ Bull Queue:`, error);
  }
}
