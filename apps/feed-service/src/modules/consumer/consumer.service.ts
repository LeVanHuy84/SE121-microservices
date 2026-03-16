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

@Injectable()
export class ConsumerService {
  private readonly logger = new Logger(ConsumerService.name);

  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshotDocument>,

    @InjectModel(ShareSnapshot.name)
    private readonly shareModel: Model<ShareSnapshot>,

    @InjectRedis()
    private readonly redis: Redis,

    private readonly affinityService: UserAffinityService,
  ) {}

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

    await this.indexEmotionToRedis(payload.targetId, newFeature, oldLabel);
  }

  async handleInteraction(payload: InteractionEventPayload): Promise<void> {
    const { userId, targetId, targetType, interactionType } = payload;

    try {
      const postId = await this.resolvePostId(targetId, targetType);
      if (!postId) return;

      const emotionSignal = await this.getEmotionSignal(postId);
      if (!emotionSignal) return;

      const weightKey = INTERACTION_TO_WEIGHT_KEY[interactionType];

      await this.affinityService.updateAffinity(
        userId,
        emotionSignal,
        weightKey,
      );
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

  private async getEmotionSignal(
    postId: string,
  ): Promise<Record<string, number> | string | null> {
    const cacheKey = `emotion:post:${postId}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const post = await this.postModel
      .findOne({ postId })
      .select('emotionFeature.label emotionFeature.scores')
      .lean();

    if (!post?.emotionFeature) return null;

    const signal = post.emotionFeature.scores ?? post.emotionFeature.label;

    await this.redis.set(cacheKey, JSON.stringify(signal), 'EX', 21600);

    return signal;
  }

  private buildEmotionFeature(payload: AnalysisResultEventPayload) {
    return {
      label: payload.finalEmotion,
      confidence: payload.confidence,
      intensity: payload.intensityScore,
      intensityLevel: payload.intensityLevel,
      dominantModality: payload.dominantModality,
      dominantScene: payload.dominantSceneType,
      scores: payload.scores,
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

    const pipeline = this.redis.pipeline();

    if (oldLabel && oldLabel !== label) {
      pipeline.zrem(`post:emotion:${oldLabel.toLowerCase()}:score`, postId);
    }

    pipeline.hset(`post:meta:${postId}`, {
      emotionLabel: label,
      emotionIntensity: intensity.toString(),
      emotionConfidence: confidence.toString(),
    });

    const emotionScoreKey = `post:emotion:${label.toLowerCase()}:score`;

    pipeline.zadd(emotionScoreKey, intensity, postId);
    pipeline.expire(emotionScoreKey, 30 * 24 * 60 * 60);

    await pipeline.exec();
  }
}
