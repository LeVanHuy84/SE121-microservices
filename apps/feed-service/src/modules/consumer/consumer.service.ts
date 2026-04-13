import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AnalysisResultEventPayload,
  InteractionEventPayload,
  RiskHintLevel,
  RootType,
  TargetType,
} from '@repo/dtos';
import { Redis } from 'ioredis';
import { Model } from 'mongoose';
import {
  EmotionFeature,
  PostSnapshot,
  PostSnapshotDocument,
} from 'src/mongo/schema/post-snapshot.schema';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';
import {
  normalizeEmotionEnum,
  normalizeEmotionScores,
} from 'src/utils/emotion-normalizer';
import { AffinityService } from '../affinity/affinity.service';
import { FeedItem } from 'src/mongo/schema/feed-item.schema';

@Injectable()
export class ConsumerService {
  private readonly logger = new Logger(ConsumerService.name);

  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshotDocument>,

    @InjectModel(ShareSnapshot.name)
    private readonly shareModel: Model<ShareSnapshot>,

    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItem>,

    @InjectRedis()
    private readonly redis: Redis,

    private readonly affinityService: AffinityService,
  ) {}

  async handleCreated(payload: AnalysisResultEventPayload) {
    await this.upsertEmotionFeature(payload);
  }

  async handleUpdated(payload: AnalysisResultEventPayload) {
    await this.upsertEmotionFeature(payload);
  }

  private async upsertEmotionFeature(
    payload: AnalysisResultEventPayload,
  ): Promise<void> {
    if (payload.targetType !== TargetType.POST) return;

    const newFeature = this.buildEmotionFeature(payload);

    /**
     * 1. UPDATE POST (atomic)
     */
    const updatedPost = await this.postModel.findOneAndUpdate(
      { postId: payload.targetId },
      {
        $set: {
          emotionFeature: newFeature,
        },
      },
      {
        new: true, // trả về doc sau update
        projection: { userId: 1, groupId: 1, 'emotionFeature.label': 1 },
      },
    );

    if (!updatedPost) return;

    const oldLabel = updatedPost.emotionFeature?.label;

    /**
     * 2. UPDATE FEED ITEM (KHÔNG CẦN CHECK)
     */
    await this.feedItemModel.updateMany(
      { postId: payload.targetId },
      {
        $set: {
          emotionLabel: newFeature.label,
        },
      },
    );

    /**
     * 3. REDIS (chỉ khi không có group)
     */
    if (!updatedPost.groupId) {
      const emotionKey = `emotion:post:${payload.targetId}`;

      await this.redis.pipeline().del(emotionKey).exec();

      await this.indexEmotionToRedis(
        payload.targetId,
        newFeature,
        updatedPost.userId,
        oldLabel,
      );
    }
  }

  async handleInteraction(payload: InteractionEventPayload): Promise<void> {
    const { userId, targetId, targetType, interactionType } = payload;

    try {
      const postId = await this.resolvePostId(targetId, targetType);
      if (!postId) return;

      const post = await this.postModel
        .findOne({ postId })
        .select('userId emotionFeature.dominantScene')
        .lean();

      if (!post) return;

      const category = post.emotionFeature?.dominantScene;
      if (!category) return;

      await this.affinityService.updateAffinity({
        userId,
        category,
        authorId: post.userId,
        type: interactionType,
      });
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

  private buildEmotionFeature(
    payload: AnalysisResultEventPayload,
  ): EmotionFeature {
    // CRITICAL: Normalize uppercase Emotion enum to lowercase keys
    const normalizedLabel = normalizeEmotionEnum(payload.finalEmotion);
    const normalizedScores = normalizeEmotionScores(payload.scores);

    return {
      label: normalizedLabel,
      confidence: payload.confidence,
      intensity: payload.intensityScore,
      intensityLevel: payload.intensityLevel,
      dominantScene: payload.dominantSceneType,
      scores: normalizedScores,
      riskHintLevel: payload.riskHintLevel as RiskHintLevel,
    };
  }

  private async indexEmotionToRedis(
    postId: string,
    emotionFeature: EmotionFeature,
    userId: string,
    oldLabel?: string,
  ) {
    const exists = await this.redis.zscore('post:score', postId);
    if (!exists) return;

    const {
      label,
      intensity,
      confidence,
      dominantScene,
      scores,
      riskHintLevel,
    } = emotionFeature;

    const normalizedLabel = normalizeEmotionEnum(label);

    const pipeline = this.redis.pipeline();

    // ------------------------------
    // 🔥 REMOVE old emotion index
    // ------------------------------
    if (oldLabel) {
      const normalizedOld = normalizeEmotionEnum(oldLabel);
      if (normalizedOld && normalizedOld !== normalizedLabel) {
        pipeline.zrem(`post:emotion:${normalizedOld}:score`, postId);
      }
    }

    // ------------------------------
    // 🔥 META (lightweight)
    // ------------------------------
    pipeline.hset(`post:meta:${postId}`, {
      emotionLabel: normalizedLabel,
      emotionIntensity: intensity.toString(),
      emotionConfidence: confidence.toString(),
    });

    // ------------------------------
    // 🔥 FULL RANK DATA (QUAN TRỌNG)
    // ------------------------------
    pipeline.hset(`post:rank:${postId}`, {
      scores: JSON.stringify(scores || {}),
      intensity: intensity.toString(),
      confidence: confidence.toString(),
      dominantScene: dominantScene || '',
      riskHintLevel: riskHintLevel || '',
      authorId: userId,
    });

    pipeline.expire(`post:rank:${postId}`, 30 * 24 * 60 * 60);

    // ------------------------------
    // 🔥 emotion index (optional filter)
    // ------------------------------
    const score = await this.redis.zscore('post:score', postId);
    if (score) {
      pipeline.zadd(
        `post:emotion:${normalizedLabel}:score`,
        Number(score),
        postId,
      );

      pipeline.expire(
        `post:emotion:${normalizedLabel}:score`,
        30 * 24 * 60 * 60,
      );
    }
    await pipeline.exec();
  }
}
