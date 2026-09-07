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

import { ProactiveInterventionService } from '../proactive-intervention/proactive-intervention.service';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly model: Model<EmotionAnalyticsSnapshot>,
    @InjectRedis()
    private readonly redis: Redis,
    private readonly proactiveInterventionService: ProactiveInterventionService,
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

    // Evaluate real-time proactive intervention (<5ms)
    try {
      await this.proactiveInterventionService.evaluateFromEvent(payload.userId, payload);
    } catch (err) {
      this.logger.error(
        `Error during real-time proactive intervention evaluation for user=${payload.userId}`,
        err,
      );
    }
  }

  // 🧠 tách mapping ra riêng
  private buildDoc(payload: AnalysisResultEventPayload) {
    const primary = payload.primaryEmotion;
    const secondaryList = payload.secondaryEmotions || [];

    return {
      userId: payload.userId,
      targetId: payload.targetId,
      targetType: payload.targetType,
      modelVersion: payload.modelVersion,
      finalEmotion: this.normalizeEmotion(primary),
      primaryEmotion: this.normalizeEmotion(primary),
      secondaryEmotions: secondaryList.map((e) => this.normalizeEmotion(e)),
      finalScores: payload.scores,
      finalConfidence: payload.confidence,
      riskHintLevel: payload.riskHintLevel ?? 'NONE',
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

  private normalizeEmotion(emotion?: string): string {
    return emotion ? emotion.toLowerCase() : '';
  }
}
