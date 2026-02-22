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
          await this.updateTrendingEmotion(
            payload.targetId,
            oldLabel as any,
            newFeature.label as any,
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

        await this.updateTrendingEmotion(
          payload.targetId,
          oldLabel as any,
          newFeature.label as any,
        );
        break;
      }
      default:
        break;
    }
  }

  private buildEmotionFeature(payload: AnalysisResultEventPayload) {
    // intensity có thể là map, lấy theo finalEmotion nếu có
    const intensityValue =
      typeof payload.intensity === 'object'
        ? (payload.intensity[payload.finalEmotion] ?? 0)
        : 0;

    return {
      label: payload.finalEmotion,
      confidence: payload.confidence,
      intensity: intensityValue,
      dominantScene: payload.dominantSceneType,
      scores: {
        [payload.finalEmotion]: payload.finalScores,
      },
      riskHintLevel: payload.riskHintLevel,
    };
  }

  private async updateTrendingEmotion(
    postId: string,
    oldEmotion?: string,
    newEmotion?: string,
  ) {
    const exists = await this.redis.zscore('post:score', postId);

    // Chưa trending thì bỏ
    if (!exists) return;

    if (oldEmotion) {
      await this.redis.srem(`post:emotion:${oldEmotion.toLowerCase()}`, postId);
    }

    if (newEmotion) {
      await this.redis.sadd(`post:emotion:${newEmotion.toLowerCase()}`, postId);
    }
  }
}
