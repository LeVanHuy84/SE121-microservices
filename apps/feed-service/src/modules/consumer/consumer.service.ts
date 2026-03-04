import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnalysisResultEventPayload, Emotion, TargetType } from '@repo/dtos';
import { Redis } from 'ioredis';
import { Model } from 'mongoose';
import {
  PostSnapshot,
  PostSnapshotDocument,
} from 'src/mongo/schema/post-snapshot.schema';

@Injectable()
export class ConsumerService {
  constructor(
    @InjectModel(PostSnapshot.name)
    private readonly postModel: Model<PostSnapshotDocument>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async handleCreated(payload: AnalysisResultEventPayload): Promise<void> {
    switch (payload.targetType) {
      case TargetType.POST: {
        const post = await this.postModel.findOne({ postId: payload.targetId });
        if (!post) return;

        const newFeature = this.buildEmotionFeature(payload);

        const oldLabel = post.emotionFeature?.label;
        post.emotionFeature = newFeature;

        await post.save();

        if (!post.groupId) {
          // ⭐ Index emotion intensity vào Redis (bao gồm cả remove old emotion)
          await this.indexEmotionToRedis(
            payload.targetId,
            newFeature,
            oldLabel,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  async handleUpdated(payload: AnalysisResultEventPayload): Promise<void> {
    switch (payload.targetType) {
      case TargetType.POST: {
        const post = await this.postModel.findOne({ postId: payload.targetId });
        if (!post) return;

        const oldLabel = post.emotionFeature?.label;

        const newFeature = this.buildEmotionFeature(payload);
        post.emotionFeature = newFeature;

        await post.save();

        // ⭐ Update emotion intensity trong Redis (bao gồm cả remove old emotion)
        await this.indexEmotionToRedis(payload.targetId, newFeature, oldLabel);
        break;
      }
      default:
        break;
    }
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

  /**
   * ⭐ Index emotion intensity vào Redis cho ranking
   * - Remove from old emotion ZSET (nếu có)
   * - Add to new emotion ZSET với intensity score
   * - Update metadata
   */
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
    if (!exists) return; // chỉ index cho trending posts

    const { label, intensity, confidence } = emotionFeature;

    // 1. Remove from old emotion ZSET (nếu emotion thay đổi)
    if (oldLabel && oldLabel !== label) {
      await this.redis.zrem(
        `post:emotion:${oldLabel.toLowerCase()}:score`,
        postId,
      );
    }

    // 2. Update post metadata với emotion fields
    const metaKey = `post:meta:${postId}`;
    await this.redis.hset(metaKey, {
      emotionLabel: label,
      emotionIntensity: intensity.toString(),
      emotionConfidence: confidence.toString(),
    });

    // 3. Add/update vào emotion-specific score ZSET (dùng intensity làm score)
    const emotionScoreKey = `post:emotion:${label.toLowerCase()}:score`;
    await this.redis.zadd(emotionScoreKey, intensity, postId);

    // 4. Set TTL
    await this.redis.expire(emotionScoreKey, 30 * 24 * 60 * 60); // 30 days
  }
}
