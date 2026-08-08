import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { StreamClient } from '@stream-io/node-sdk';
import {
  CallMediaProvider,
  MediaProviderName,
} from './media-provider.interface';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

@Injectable()
export class StreamMediaProvider implements CallMediaProvider {
  readonly name: MediaProviderName = 'stream';
  private readonly streamApiKey: string;
  private readonly streamApiSecret: string;
  private readonly streamCallType: string;
  private readonly streamTokenTtlSec: number;
  private readonly streamBaseUrl: string;
  private readonly callScreenShareEnabled: boolean;
  private readonly callScreenShareModeratorOnly: boolean;
  private readonly defaultGroupLimit: number;
  private readonly streamClient: StreamClient;

  constructor(
    private readonly configService: ConfigService,
    @InjectRedis() private readonly redis: Redis,
  ) {
    this.streamApiKey = this.getStringConfig('STREAM_API_KEY', '');
    this.streamApiSecret = this.getStringConfig('STREAM_API_SECRET', '');
    this.streamCallType = this.getStringConfig('STREAM_CALL_TYPE', 'default');
    this.streamTokenTtlSec = this.getNumberConfig('STREAM_TOKEN_TTL_SEC', 3600);
    this.streamBaseUrl = this.getStringConfig('STREAM_BASE_URL', '');
    this.callScreenShareEnabled = this.getBooleanConfig(
      'CALL_SCREEN_SHARE_ENABLED',
      true,
    );
    this.callScreenShareModeratorOnly = this.getBooleanConfig(
      'CALL_SCREEN_SHARE_MODERATOR_ONLY',
      true,
    );
    this.defaultGroupLimit = this.getNumberConfig(
      'GROUP_CALL_MAX_PARTICIPANTS',
      10,
    );
    this.streamClient = new StreamClient(
      this.streamApiKey,
      this.streamApiSecret,
    );
  }

  async registerCall(params: {
    callId: string;
    conversationId: string;
    initiatorId: string;
    participants: string[];
    moderatorUserIds: string[];
  }): Promise<void> {
    const {
      callId,
      conversationId,
      initiatorId,
      participants,
      moderatorUserIds,
    } = params;
    this.assertStreamConfig();

    // Ensure all participants exist in Stream - with Redis cache
    const needsUpsert: string[] = [];
    for (const participantId of participants) {
      const cacheKey = `stream:user_upserted:${participantId}`;
      const exists = await this.redis.exists(cacheKey);
      if (!exists) {
        needsUpsert.push(participantId);
      }
    }

    if (needsUpsert.length > 0) {
      await this.streamClient.upsertUsers(
        needsUpsert.map((participantId: string) => ({
          id: participantId,
          role: moderatorUserIds.includes(participantId) ? 'admin' : 'user',
        })),
      );

      const pipeline = this.redis.pipeline();
      for (const participantId of needsUpsert) {
        pipeline.set(`stream:user_upserted:${participantId}`, '1', 'EX', 86400); // 24h
      }
      await pipeline.exec();
    }

    // Create the call on Stream's side
    await this.streamClient.video.getOrCreateCall({
      type: this.streamCallType,
      id: callId,
      data: {
        created_by_id: initiatorId,
        members: participants.map((participantId: string) => ({
          user_id: participantId,
          role: moderatorUserIds.includes(participantId) ? 'admin' : 'user',
        })),
        custom: {
          callSessionId: callId,
          conversationId,
        },
      },
    });
  }

  async issueUserToken(userId: string): Promise<string> {
    this.assertStreamConfig();
    const nowSec = Math.floor(Date.now() / 1000);
    // Set iat 120 seconds in the past to absorb developer machine clock skew
    const iat = nowSec - 120;
    const exp = nowSec + this.streamTokenTtlSec;
    return this.streamClient.generateUserToken({ user_id: userId, exp, iat });
  }

  async getActiveParticipantsCount(callId: string): Promise<number> {
    this.assertStreamConfig();
    try {
      const response = await this.streamClient.video
        .call(this.streamCallType, callId)
        .get();
      return response.call.session?.participants?.length ?? 0;
    } catch (error) {
      return 0;
    }
  }

  // Phase 3.4: End the call room on Stream's side to avoid zombie sessions after cancel
  async endCallOnStream(callId: string): Promise<void> {
    this.assertStreamConfig();
    try {
      await this.streamClient.video.call(this.streamCallType, callId).end();
    } catch (error) {
      // Non-fatal — call may already be gone on Stream
      throw error;
    }
  }

  private assertStreamConfig() {
    if (!this.streamApiKey || !this.streamApiSecret) {
      throw new RpcException('Stream media infra is not configured');
    }
  }

  private getStringConfig(key: string, fallback = ''): string {
    return this.configService.get<string>(key) ?? fallback;
  }

  private getNumberConfig(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

  private getBooleanConfig(key: string, fallback: boolean): boolean {
    const raw = this.configService.get<string | boolean>(key);
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'yes')
        return true;
      if (normalized === 'false' || normalized === '0' || normalized === 'no')
        return false;
    }
    return fallback;
  }
}
