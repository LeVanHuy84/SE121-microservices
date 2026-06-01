import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import type { Queue } from 'bull';
import { Types } from 'mongoose';
import { NotificationDocument } from 'src/mongo/schema/notification.schema';
import { FirebaseService } from 'src/firebase/firebase.service';
import { DeviceTokenService } from 'src/firebase/device-token.service';
import { TemplateService } from '../template.service';
import {
  NOTIFICATION_QUEUE,
  REGULAR_NOTIFICATION_DELIVERY_JOB,
} from '../notification.jobs';

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly firebaseService: FirebaseService,
    private readonly deviceTokenService: DeviceTokenService,
    private readonly templateService: TemplateService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async dispatchToQueue(doc: NotificationDocument, sendAt?: Date) {
    const delay =
      sendAt && sendAt.getTime() > Date.now()
        ? Math.max(0, sendAt.getTime() - Date.now())
        : 0;

    await this.notificationQueue.add(
      REGULAR_NOTIFICATION_DELIVERY_JOB,
      { id: doc._id.toString() },
      {
        jobId: `regular:${doc._id.toString()}`,
        delay,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    );

    if (delay > 0) {
      this.logger.log(`Notification ${doc._id} scheduled in ${delay}ms`);
    } else {
      this.logger.log(`Notification ${doc._id} enqueued for delivery`);
    }
  }

  async publishToChannels(doc: NotificationDocument) {
    const isOnline = await this.checkUserOnline(doc.userId);
    if (isOnline) {
      this.logger.debug(`User ${doc.userId} is online, skipping push notification`);
      return;
    }

    await this.sendPushNotification(doc);
    this.logger.log(
      `Sent push notification ${doc._id} via FCM to user ${doc.userId}`,
    );
  }

  private async checkUserOnline(userId: string): Promise<boolean> {
    try {
      const status = await this.redis.hget(`presence:user:${userId}`, 'status');
      return status === 'online';
    } catch (e) {
      this.logger.warn(`Failed to check presence for user ${userId}: ${e.message}`);
      return false;
    }
  }

  private async sendPushNotification(doc: NotificationDocument) {
    const deviceTokens = await this.deviceTokenService.getActiveTokensByUserId(
      doc.userId,
    );

    if (deviceTokens.length === 0) {
      this.logger.warn(`No device tokens found for user ${doc.userId}`);
      return;
    }

    const tokens = deviceTokens.map((deviceToken) => deviceToken.token);
    const renderedTemplate = this.templateService.renderTemplate(
      doc.type,
      doc.payload as any,
    );
    const result = await this.firebaseService.sendToMultipleDevices(
      tokens,
      renderedTemplate.title,
      renderedTemplate.body || doc.message || 'Bạn có thông báo mới',
      {
        notificationId: (doc._id as Types.ObjectId).toString(),
        type: doc.type,
        userId: doc.userId,
        ...renderedTemplate.data,
      },
      {
        androidChannelId: renderedTemplate.delivery.androidChannelId,
      },
    );

    this.logger.log(
      `FCM sent to ${result.successCount}/${tokens.length} devices for user ${doc.userId}`,
    );

    if (result.invalidTokens.length > 0) {
      await this.deviceTokenService.markTokensAsInvalid(result.invalidTokens);
      this.logger.warn(
        `Marked ${result.invalidTokens.length} invalid tokens as inactive`,
      );
    }
  }
}
