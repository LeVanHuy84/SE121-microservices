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
    // Xử lý sự kiện CREATED ở đây
    console.log('Handling CREATED event:', payload);
    switch (payload.targetType) {
      case TargetType.POST:
        const post = await this.postModel.findOne({ postId: payload.targetId });
        if (post) {
          post.mainEmotion = payload.finalEmotion as Emotion;
          await post.save();
          if (!post.groupId) {
            await this.updateTrendingEmotion(
              payload.targetId,
              undefined,
              payload.finalEmotion as Emotion,
            );
          }
        }

        break;
      default:
        break;
    }
  }

  async handleUpdated(payload: AnalysisResultEventPayload): Promise<void> {
    // Xử lý sự kiện UPDATED ở đây
    console.log('Handling UPDATED event:', payload);
    switch (payload.targetType) {
      case TargetType.POST:
        const post = await this.postModel.findOne({ postId: payload.targetId });
        if (post) {
          const oldEmotion = post.mainEmotion;
          post.mainEmotion = payload.finalEmotion as Emotion;
          await post.save();
          await this.updateTrendingEmotion(
            payload.targetId,
            oldEmotion,
            payload.finalEmotion as Emotion,
          );
        }
        break;
      default:
        break;
    }
  }

  private async updateTrendingEmotion(
    postId: string,
    oldEmotion?: Emotion,
    newEmotion?: Emotion,
  ) {
    const score = await this.redis.zscore('post:score', postId);

    // Nếu bài chưa có trong trending -> bỏ qua
    if (!score) return;

    const numericScore = parseFloat(score);

    // 1. Xóa khỏi old emotion key
    if (oldEmotion) {
      const oldKey = `post:score:emotion:${oldEmotion.toLowerCase()}`;
      await this.redis.zrem(oldKey, postId);
    }

    // 2. Thêm vào new emotion key
    if (newEmotion) {
      const newKey = `post:score:emotion:${newEmotion.toLowerCase()}`;
      await this.redis.zadd(newKey, numericScore, postId);
    }
  }
}
