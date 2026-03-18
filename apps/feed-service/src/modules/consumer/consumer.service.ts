import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AnalysisResultEventPayload,
  InteractionEventPayload,
  RootType,
  TargetType,
} from '@repo/dtos';
import { Redis } from 'ioredis';
import { Model } from 'mongoose';
import {
  PostSnapshot,
  PostSnapshotDocument,
} from 'src/mongo/schema/post-snapshot.schema';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';
import { UserAffinityService } from '../affinity/user-affinity.service';
import { INTERACTION_TO_WEIGHT_KEY } from '../affinity/affinity.constants';
import {
  normalizeEmotionEnum,
  normalizeEmotionScores,
} from 'src/utils/emotion-normalizer';

@Injectable()
export class ConsumerService {
  private readonly logger = new Logger(ConsumerService.name);
  private readonly emotionLocalCache = new Map<
    string,
    {
      emotionSignal: Record<string, number> | string;
      dominantScene?: string;
      ts: number;
    }
  >();

  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshotDocument>,

    @InjectModel(ShareSnapshot.name)
    private readonly shareModel: Model<ShareSnapshot>,

    @InjectRedis()
    private readonly redis: Redis,

    private readonly affinityService: UserAffinityService,
  ) {}

  private readonly emotionSignalCacheTtlSeconds = 21600;

  async handleCreated(payload: AnalysisResultEventPayload): Promise<void> {
    if (payload.targetType !== TargetType.POST) return;

    const post = await this.postModel.findOne({ postId: payload.targetId });
    if (!post) return;

    const newFeature = this.buildEmotionFeature(payload);
    const oldLabel = post.emotionFeature?.label;

    post.emotionFeature = newFeature;
    await post.save();

    if (!post.groupId) {
      await this.indexEmotionToRedis(payload.targetId, newFeature, oldLabel);
    }
  }

  async handleUpdated(payload: AnalysisResultEventPayload): Promise<void> {
    if (payload.targetType !== TargetType.POST) return;

    const post = await this.postModel.findOne({ postId: payload.targetId });
    if (!post) return;

    const oldLabel = post.emotionFeature?.label;
    const newFeature = this.buildEmotionFeature(payload);

    post.emotionFeature = newFeature;
    await post.save();

    const emotionKey = `emotion:post:${payload.targetId}`;

    await this.redis.pipeline().del(emotionKey).exec();

    this.emotionLocalCache.delete(payload.targetId);

    await this.indexEmotionToRedis(payload.targetId, newFeature, oldLabel);
  }

  async handleInteraction(payload: InteractionEventPayload): Promise<void> {
    const { userId, targetId, targetType, interactionType } = payload;

    try {
      const postId = await this.resolvePostId(targetId, targetType);
      if (!postId) return;

      const emotionContext = await this.getEmotionSignal(postId);
      if (!emotionContext) return;

      const weightKey = INTERACTION_TO_WEIGHT_KEY[interactionType];

      await this.affinityService.updateAffinity(
        userId,
        emotionContext.emotionSignal,
        weightKey,
      );

      if (emotionContext.dominantScene) {
        await this.affinityService.updateSceneAffinity(
          userId,
          emotionContext.dominantScene,
          weightKey,
        );
      }
    } catch (err) {
      this.logger.error('handleInteraction error', err);
    }
  }

  private async resolvePostId(
    targetId: string,
    targetType: RootType,
  ): Promise<string | null> {
    if (targetType === RootType.POST) return targetId;

    const cacheKey = `share:post:${targetId}`;

    let postId = await this.redis.get(cacheKey);
    if (postId) return postId;

    const share = await this.shareModel
      .findOne({ shareId: targetId })
      .select('postId')
      .lean();

    if (!share) return null;

    postId = share.postId;

    await this.redis.set(cacheKey, postId, 'EX', 86400);

    return postId;
  }

  private async getEmotionSignal(postId: string): Promise<{
    emotionSignal: Record<string, number> | string;
    dominantScene?: string;
  } | null> {
    const local = this.emotionLocalCache.get(postId);

    if (local) {
      const age = Date.now() - local.ts;

      // TTL memory cache = 10 phút
      if (age < 10 * 60 * 1000) {
        return {
          emotionSignal: local.emotionSignal,
          dominantScene: local.dominantScene,
        };
      }

      this.emotionLocalCache.delete(postId);
    }

    const cacheKey = `emotion:post:${postId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = this.parseEmotionSignalCache(cached);
      if (parsed) {
        this.setEmotionLocalCache(postId, parsed);
      }
      return parsed;
    }

    const post = await this.postModel
      .findOne({ postId })
      .select(
        'emotionFeature.label emotionFeature.scores emotionFeature.dominantScene',
      )
      .lean();

    if (!post?.emotionFeature) return null;

    const payload = {
      emotionSignal: post.emotionFeature.scores ?? post.emotionFeature.label,
      dominantScene: post.emotionFeature.dominantScene,
    };

    await this.redis.set(
      cacheKey,
      JSON.stringify(payload),
      'EX',
      this.emotionSignalCacheTtlSeconds,
    );

    this.setEmotionLocalCache(postId, payload);

    return payload;
  }

  private setEmotionLocalCache(
    postId: string,
    payload: {
      emotionSignal: Record<string, number> | string;
      dominantScene?: string;
    },
  ): void {
    this.emotionLocalCache.set(postId, {
      ...payload,
      ts: Date.now(),
    });

    if (this.emotionLocalCache.size > 5000) {
      const keys = [...this.emotionLocalCache.keys()];
      const evictCount = Math.min(500, keys.length);

      for (let i = 0; i < evictCount; i += 1) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        this.emotionLocalCache.delete(key);
      }
    }
  }

  private parseEmotionSignalCache(cached: string): {
    emotionSignal: Record<string, number> | string;
    dominantScene?: string;
  } | null {
    const parsed: unknown = JSON.parse(cached);

    if (typeof parsed === 'string') {
      return {
        emotionSignal: parsed,
      };
    }

    if (this.isEmotionScoreMap(parsed)) {
      return {
        emotionSignal: parsed,
      };
    }

    if (!this.isCachedEmotionContext(parsed)) {
      return null;
    }

    if (
      typeof parsed.emotionSignal !== 'string' &&
      !this.isEmotionScoreMap(parsed.emotionSignal)
    ) {
      return null;
    }

    return {
      emotionSignal: parsed.emotionSignal,
      dominantScene:
        typeof parsed.dominantScene === 'string'
          ? parsed.dominantScene
          : undefined,
    };
  }

  private isCachedEmotionContext(value: unknown): value is {
    emotionSignal?: unknown;
    dominantScene?: unknown;
  } {
    return (
      typeof value === 'object' && value !== null && 'emotionSignal' in value
    );
  }

  private isEmotionScoreMap(value: unknown): value is Record<string, number> {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    return Object.values(value).every(
      (entry) => typeof entry === 'number' && Number.isFinite(entry),
    );
  }

  private buildEmotionFeature(payload: AnalysisResultEventPayload) {
    // CRITICAL: Normalize uppercase Emotion enum to lowercase keys
    const normalizedLabel = normalizeEmotionEnum(payload.finalEmotion);
    const normalizedScores = normalizeEmotionScores(payload.scores);

    return {
      label: normalizedLabel,
      confidence: payload.confidence,
      intensity: payload.intensityScore,
      intensityLevel: payload.intensityLevel,
      dominantModality: payload.dominantModality,
      dominantScene: payload.dominantSceneType,
      scores: normalizedScores,
      riskHintLevel: payload.riskHintLevel,
    };
  }

  private async indexEmotionToRedis(
    postId: string,
    emotionFeature: {
      label: string;
      intensity: number;
      confidence: number;
    },
    oldLabel?: string,
  ) {
    const exists = await this.redis.zscore('post:score', postId);
    if (!exists) return;

    const { label, intensity, confidence } = emotionFeature;

    // CRITICAL: Ensure label is lowercase for Redis key consistency
    const normalizedLabel = normalizeEmotionEnum(label);

    const pipeline = this.redis.pipeline();

    if (oldLabel) {
      // Normalize old label as well
      const normalizedOldLabel = normalizeEmotionEnum(oldLabel);
      if (normalizedOldLabel && normalizedOldLabel !== normalizedLabel) {
        pipeline.zrem(`post:emotion:${normalizedOldLabel}:score`, postId);
      }
    }

    pipeline.hset(`post:meta:${postId}`, {
      emotionLabel: normalizedLabel,
      emotionIntensity: intensity.toString(),
      emotionConfidence: confidence.toString(),
    });

    const emotionScoreKey = `post:emotion:${normalizedLabel}:score`;

    pipeline.zadd(emotionScoreKey, intensity, postId);
    pipeline.expire(emotionScoreKey, 30 * 24 * 60 * 60);

    await pipeline.exec();
  }
}
