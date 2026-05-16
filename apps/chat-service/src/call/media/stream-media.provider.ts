import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { CallMediaTokenResponseDTO } from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { StreamClient } from '@stream-io/node-sdk';
import {
  CallMediaProvider,
  IssueMediaTokenContext,
  MediaProviderName,
} from './media-provider.interface';

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

  constructor(private readonly configService: ConfigService) {
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
    this.defaultGroupLimit = this.getNumberConfig('GROUP_CALL_MAX_PARTICIPANTS', 10);
    this.streamClient = new StreamClient(this.streamApiKey, this.streamApiSecret);
  }

  async issueParticipantToken(
    context: IssueMediaTokenContext,
  ): Promise<CallMediaTokenResponseDTO> {
    const { call, userId, preferAudioOnly, moderatorUserIds } = context;
    this.assertStreamConfig();

    const callId = call._id?.toString?.() ?? String(call._id);
    const conversationId =
      call.conversationId?.toString?.() ?? String(call.conversationId);
    const isModerator = moderatorUserIds.includes(userId);
    const audioOnly = Boolean(preferAudioOnly);
    const callCid = `${this.streamCallType}:${callId}`;

    await this.streamClient.upsertUsers(
      call.participants.map((participantId: string) => ({
        id: participantId,
        role: moderatorUserIds.includes(participantId) ? 'admin' : 'user',
      })),
    );

    await this.streamClient.video.getOrCreateCall({
      type: this.streamCallType,
      id: callId,
      data: {
        created_by_id: call.initiatorId,
        members: call.participants.map((participantId: string) => ({
          user_id: participantId,
          role: moderatorUserIds.includes(participantId) ? 'admin' : 'user',
        })),
        custom: {
          callSessionId: callId,
          conversationId,
        },
      },
    });

    const token = this.streamClient.generateCallToken({
      user_id: userId,
      role: isModerator ? 'admin' : 'user',
      call_cids: [callCid],
      validity_in_seconds: this.streamTokenTtlSec,
    });

    return plainToInstance(CallMediaTokenResponseDTO, {
      token,
      wsUrl: this.streamBaseUrl,
      roomName: callCid,
      participantIdentity: userId,
      callId,
      conversationId,
      expiresAt: new Date(Date.now() + this.streamTokenTtlSec * 1000),
      audioOnly,
      iceServers: [],
      policy: {
        participantLimit: call.maxParticipants ?? this.defaultGroupLimit,
        moderatorUserIds,
        screenShareAllowed: this.callScreenShareEnabled,
        screenShareModeratorOnly: this.callScreenShareModeratorOnly,
      },
    });
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
