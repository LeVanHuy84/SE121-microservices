import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { ClearChatPushStateDto, SendChatPushDto } from '@repo/dtos';
import Redis from 'ioredis';
import { DeviceTokenService } from 'src/firebase/device-token.service';
import { FirebaseService } from 'src/firebase/firebase.service';

@Injectable()
export class ChatPushService {
  private readonly logger = new Logger(ChatPushService.name);
  private readonly stateTtlSeconds = Number(
    process.env.CHAT_PUSH_STATE_TTL_SECONDS ?? 7 * 24 * 60 * 60,
  );

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly firebaseService: FirebaseService,
    private readonly deviceTokenService: DeviceTokenService,
  ) {}

  async sendChatPush(dto: SendChatPushDto) {
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
    const tokens = deviceTokens.map((item) => item.token);

    const result = await this.firebaseService.sendToMultipleDevices(
      tokens,
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
          ? dto.conversationName || 'Nhóm chat'
          : dto.senderName,
        apnsSummaryArgCount: unreadCount,
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
        return `${unreadCount} tin nhan moi`;
      }

      return dto.conversationName || 'Tin nhan nhom moi';
    }

    if (unreadCount > 1) {
      return `${unreadCount} tin nhan moi`;
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
        return `Trong ${dto.conversationName || 'nhom chat'}`;
      }

      return preview ? `${dto.senderName}: ${preview}` : dto.senderName;
    }

    if (unreadCount > 1) {
      return `Tu ${dto.senderName}`;
    }

    return preview || 'Ban co tin nhan moi';
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
      return 'Ban co tin nhan moi';
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 120
      ? `${normalized.slice(0, 117).trim()}...`
      : normalized;
  }
}
