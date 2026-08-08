import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import {
  ClearChatPushStateDto,
  SendCallPushDto,
  SendChatPushDto,
} from '@repo/dtos';
import type { Queue } from 'bull';
import Redis from 'ioredis';
import { DeviceTokenService } from 'src/firebase/device-token.service';
import { FirebaseService } from 'src/firebase/firebase.service';
import {
  CALL_CANCEL_PUSH_DELIVERY_JOB,
  CALL_PUSH_DELIVERY_JOB,
  CHAT_PUSH_DELIVERY_JOB,
  NOTIFICATION_QUEUE,
} from './notification.jobs';
import { NotificationPolicyService } from './services/notification-policy.service';

type ActiveDeviceToken = Awaited<
  ReturnType<DeviceTokenService['getActiveTokensByUserId']>
>[number];

@Injectable()
export class ChatPushService {
  private readonly logger = new Logger(ChatPushService.name);
  private readonly stateTtlSeconds = Number(
    process.env.CHAT_PUSH_STATE_TTL_SECONDS ?? 7 * 24 * 60 * 60,
  );
  private readonly nativeAndroidAppId =
    process.env.NATIVE_ANDROID_APP_ID ?? 'com.sentimeta.app';

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly notificationQueue: Queue,
    @InjectRedis() private readonly redis: Redis,
    private readonly firebaseService: FirebaseService,
    private readonly deviceTokenService: DeviceTokenService,
    private readonly policyService: NotificationPolicyService,
  ) {}

  async enqueueChatPush(dto: SendChatPushDto) {
    await this.notificationQueue.add(
      CHAT_PUSH_DELIVERY_JOB,
      { sendChatPushDto: dto },
      {
        jobId: `chat:${dto.userId}:${dto.messageId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
      },
    );
  }

  async enqueueCallPush(dto: SendCallPushDto) {
    await this.notificationQueue.add(
      CALL_PUSH_DELIVERY_JOB,
      { sendCallPushDto: dto },
      {
        jobId: `call:${dto.userId}:${dto.callId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      },
    );
  }

  async enqueueCallCancelPush(dto: {
    callId: string;
    conversationId: string;
    actorId: string;
    userId: string;
  }) {
    await this.notificationQueue.add(
      CALL_CANCEL_PUSH_DELIVERY_JOB,
      dto,
      {
        jobId: `call-cancel:${dto.userId}:${dto.callId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
      },
    );
  }

  async sendChatPush(dto: SendChatPushDto) {
    const policy = await this.policyService.checkPreferencesOnly(dto.userId, dto.isGroup ? 'group_message' : 'chat_message');
    if (!policy.allowed) {
      this.logger.debug(`Skip chat push for user ${dto.userId}: suppressed by policy (${policy.reason})`);
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const isFocused = await this.checkUserFocused(dto.userId, dto.conversationId);
    if (isFocused) {
      this.logger.debug(`Skip chat push for user ${dto.userId}: user is focused on conversation`);
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const deviceTokens = await this.deviceTokenService.getActiveTokensByUserId(
      dto.userId,
    );
    if (!deviceTokens.length) {
      this.logger.debug(
        `Skip chat push for user ${dto.userId}: no active device tokens`,
      );
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [] as string[],
      };
    }

    const unreadCount = await this.incrementUnreadState(dto);
    const preview = this.sanitizePreview(dto.preview);
    const title = this.buildTitle(dto, unreadCount);
    const body = this.buildBody(dto, preview, unreadCount);
    const data = this.buildData(dto, unreadCount, preview);
    const conversationTag = `chat:${dto.conversationId}`;

    const androidNativeTokens = deviceTokens
      .filter((token) => this.isNativeAndroidTarget(token))
      .map((token) => token.token);
    const fallbackTokens = deviceTokens
      .filter((token) => !this.isNativeAndroidTarget(token))
      .map((token) => token.token);

    const [androidNativeResult, fallbackResult] = await Promise.all([
      this.firebaseService.sendDataOnlyToMultipleDevices(
        androidNativeTokens,
        {
          ...data,
          displayTitle: title,
          displayBody: body,
          channelId: 'messages',
          conversationTag,
        },
        {
          collapseKey: conversationTag,
        },
      ),
      this.firebaseService.sendToMultipleDevices(
        fallbackTokens,
        title,
        body,
        data,
        {
          collapseKey: conversationTag,
          androidTag: conversationTag,
          androidChannelId: 'messages',
          apnsCollapseId: conversationTag,
          apnsThreadId: conversationTag,
          apnsSummaryArg: dto.isGroup
            ? dto.conversationName || 'Nhóm chat'
            : dto.senderName,
          apnsSummaryArgCount: unreadCount,
        },
      ),
    ]);

    const invalidTokens = [
      ...androidNativeResult.invalidTokens,
      ...fallbackResult.invalidTokens,
    ];

    if (invalidTokens.length > 0) {
      await this.deviceTokenService.markTokensAsInvalid(invalidTokens);
    }

    return {
      successCount:
        androidNativeResult.successCount + fallbackResult.successCount,
      failureCount:
        androidNativeResult.failureCount + fallbackResult.failureCount,
      invalidTokens,
    };
  }

  async sendCallPush(dto: SendCallPushDto) {
    const policy = await this.policyService.checkPreferencesOnly(dto.userId, 'call');
    if (!policy.allowed) {
      this.logger.debug(`Skip call push for user ${dto.userId}: suppressed by policy (${policy.reason})`);
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const deviceTokens = await this.deviceTokenService.getActiveTokensByUserId(
      dto.userId,
    );
    if (!deviceTokens.length) {
      this.logger.debug(
        `Skip call push for user ${dto.userId}: no active device tokens`,
      );
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [] as string[],
      };
    }

    const title = dto.isGroup
      ? dto.conversationName || 'Cuộc gọi nhóm'
      : dto.callerName;
    const callLabel = dto.callType === 'video' ? 'video' : 'audio';
    const body = `Cuộc gọi ${callLabel} đến từ ${dto.callerName}`;

    const data = {
      type: 'call',
      userId: dto.userId,
      callId: dto.callId,
      callType: dto.callType,
      conversationId: dto.conversationId,
      callerId: dto.callerId,
      callerName: dto.callerName,
      callerAvatar: dto.callerAvatar || '',
      conversationName: dto.conversationName || '',
      isGroup: dto.isGroup ? 'true' : 'false',
    };

    const conversationTag = `call:${dto.conversationId}`;

    const androidNativeTokens = deviceTokens
      .filter((token) => this.isNativeAndroidTarget(token))
      .map((token) => token.token);
    const fallbackTokens = deviceTokens
      .filter((token) => !this.isNativeAndroidTarget(token))
      .map((token) => token.token);

    const [androidNativeResult, fallbackResult] = await Promise.all([
      // Android Native: Data-only (high priority) to trigger Ringer/Full-screen UI
      this.firebaseService.sendDataOnlyToMultipleDevices(
        androidNativeTokens,
        {
          ...data,
          displayTitle: title,
          displayBody: body,
          channelId: 'calls',
          priority: 'high',
        },
        {
          collapseKey: conversationTag,
          apnsPriority: 10,
          apnsPushType: 'background',
          contentAvailable: true,
        },
      ),
      // iOS/Fallback: Notification + Data (high priority)
      this.firebaseService.sendToMultipleDevices(
        fallbackTokens,
        title,
        body,
        data,
        {
          collapseKey: conversationTag,
          androidTag: conversationTag,
          androidChannelId: 'calls',
          apnsCollapseId: conversationTag,
          apnsThreadId: conversationTag,
          apnsPriority: 10,
          apnsPushType: 'alert',
        },
      ),
    ]);

    const invalidTokens = [
      ...androidNativeResult.invalidTokens,
      ...fallbackResult.invalidTokens,
    ];

    if (invalidTokens.length > 0) {
      await this.deviceTokenService.markTokensAsInvalid(invalidTokens);
    }

    return {
      successCount:
        androidNativeResult.successCount + fallbackResult.successCount,
      failureCount:
        androidNativeResult.failureCount + fallbackResult.failureCount,
      invalidTokens,
    };
  }

  async sendCallCancelPush(dto: {
    callId: string;
    conversationId: string;
    actorId: string;
    userId: string;
  }) {
    const policy = await this.policyService.checkPreferencesOnly(dto.userId, 'call');
    if (!policy.allowed) {
      this.logger.debug(`Skip call cancel push for user ${dto.userId}: suppressed by policy (${policy.reason})`);
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const deviceTokens = await this.deviceTokenService.getActiveTokensByUserId(
      dto.userId,
    );
    if (!deviceTokens.length) return;

    const data = {
      type: 'call_cancelled',
      callId: dto.callId,
      conversationId: dto.conversationId,
      actorId: dto.actorId,
    };

    const conversationTag = `call:${dto.conversationId}`;

    const tokens = deviceTokens.map((t) => t.token);

    // Send high-priority silent push to all devices
    const result = await this.firebaseService.sendDataOnlyToMultipleDevices(
      tokens,
      data,
      {
        collapseKey: conversationTag,
        apnsPriority: 10,
        apnsPushType: 'background',
        contentAvailable: true,
      },
    );

    if (result.invalidTokens.length > 0) {
      await this.deviceTokenService.markTokensAsInvalid(result.invalidTokens);
    }

    return result;
  }

  async clearChatPushState(dto: ClearChatPushStateDto) {
    const keys = this.getStateKeys(dto.userId, dto.conversationId);
    await this.redis.del(keys.unread, keys.lastSender, keys.lastPreview);
  }

  private isNativeAndroidTarget(token: ActiveDeviceToken) {
    return (
      token.platform === 'android' && token.appId === this.nativeAndroidAppId
    );
  }

  private async checkUserFocused(userId: string, conversationId: string): Promise<boolean> {
    try {
      const count = await this.redis.scard(`chat:activeConv:user:${userId}:${conversationId}`);
      return count > 0;
    } catch (e) {
      this.logger.warn(`Failed to check focus for user ${userId}: ${e.message}`);
      return false;
    }
  }

  private async incrementUnreadState(dto: SendChatPushDto): Promise<number> {
    const keys = this.getStateKeys(dto.userId, dto.conversationId);
    const multi = this.redis.multi();
    multi.incr(keys.unread);
    multi.set(keys.lastSender, dto.senderName, 'EX', this.stateTtlSeconds);
    multi.set(
      keys.lastPreview,
      this.sanitizePreview(dto.preview),
      'EX',
      this.stateTtlSeconds,
    );
    multi.expire(keys.unread, this.stateTtlSeconds);

    const results = await multi.exec();
    const unreadCount = Number(results?.[0]?.[1] ?? 1);
    return Number.isFinite(unreadCount) && unreadCount > 0 ? unreadCount : 1;
  }

  private buildTitle(dto: SendChatPushDto, unreadCount: number): string {
    if (dto.isGroup) {
      if (unreadCount > 1) {
        return `${unreadCount} tin nhắn mới`;
      }

      return dto.conversationName || 'Tin nhắn nhóm mới';
    }

    if (unreadCount > 1) {
      return `${unreadCount} tin nhắn mới`;
    }

    return dto.senderName;
  }

  private buildBody(
    dto: SendChatPushDto,
    preview: string,
    unreadCount: number,
  ): string {
    if (dto.isGroup) {
      if (unreadCount > 1) {
        return `Trong ${dto.conversationName || 'nhóm chat'}`;
      }

      return preview ? `${dto.senderName}: ${preview}` : dto.senderName;
    }

    if (unreadCount > 1) {
      return `Từ ${dto.senderName}`;
    }

    return preview || 'Bạn có tin nhắn mới';
  }

  private buildData(
    dto: SendChatPushDto,
    unreadCount: number,
    preview: string,
  ): Record<string, string> {
    return {
      type: 'message',
      userId: dto.userId,
      messageId: dto.messageId,
      conversationId: dto.conversationId,
      senderId: dto.senderId,
      senderName: dto.senderName,
      senderAvatar: dto.senderAvatar || '',
      conversationName: dto.conversationName || '',
      isGroup: dto.isGroup ? 'true' : 'false',
      preview,
      unreadCount: String(unreadCount),
    };
  }

  private getStateKeys(userId: string, conversationId: string) {
    const prefix = `chat:push:${userId}:${conversationId}`;
    return {
      unread: `${prefix}:unread`,
      lastSender: `${prefix}:lastSender`,
      lastPreview: `${prefix}:lastPreview`,
    };
  }

  private sanitizePreview(value?: string) {
    if (!value?.trim()) {
      return 'Bạn có tin nhắn mới';
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 120
      ? `${normalized.slice(0, 117).trim()}...`
      : normalized;
  }
}
