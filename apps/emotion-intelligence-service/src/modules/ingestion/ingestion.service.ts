import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnalysisResultEventPayload } from '@repo/dtos';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import {
  PROFILE_DIRTY_USERS_KEY,
  SNAPSHOT_DIRTY_USERS_KEY,
} from 'src/common/constants';
import { EmotionAnalyticsSnapshot } from 'src/mongo/schema/analytic-snapshot.schema';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly model: Model<EmotionAnalyticsSnapshot>,
    @InjectRedis()
    private readonly redis: Redis,
  ) {}

  async handleCreated(payload: AnalysisResultEventPayload) {
    await this.processEvent(payload);
  }

  async handleUpdated(payload: AnalysisResultEventPayload) {
    await this.processEvent(payload);
  }

  async handleAnalysisResult(payload: AnalysisResultEventPayload) {
    await this.processEvent(payload);
  }

  private async processEvent(payload: AnalysisResultEventPayload) {
    await this.upsertSnapshot(payload);
    await this.markUserDirty(payload.userId);
  }

  // 🧠 tách mapping ra riêng
  private buildDoc(payload: AnalysisResultEventPayload) {
    return {
      userId: payload.userId,
      targetId: payload.targetId,
      targetType: payload.targetType,
      finalEmotion: this.normalizeEmotion(payload.finalEmotion),
      finalScores: payload.scores,
      finalConfidence: payload.confidence,
      riskHintLevel: payload.riskHintLevel ?? 'LOW',
      createdAt: payload.createdAt ?? new Date(),
    };
  }

  private async upsertSnapshot(payload: AnalysisResultEventPayload) {
    const doc = this.buildDoc(payload);

    try {
      await this.model.updateOne(
        {
          userId: doc.userId,
          targetId: doc.targetId,
          targetType: doc.targetType,
        },
        { $set: doc },
        { upsert: true },
      );
    } catch (err) {
      this.logger.error(
        `Failed to upsert snapshot for user=${payload.userId}`,
        err,
      );
      throw err;
    }
  }

  private async markUserDirty(userId: string) {
    try {
      await this.redis.sadd(PROFILE_DIRTY_USERS_KEY, userId);
      await this.redis.sadd(SNAPSHOT_DIRTY_USERS_KEY, userId);
    } catch (err) {
      this.logger.warn(
        `Failed to mark dirty user=${userId} (non-blocking)`,
        err,
      );
    }
  }

  private normalizeEmotion(emotion: string): string {
    return emotion.toLowerCase();
  }
}
