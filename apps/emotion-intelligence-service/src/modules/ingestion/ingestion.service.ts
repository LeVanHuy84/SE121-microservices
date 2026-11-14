import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AnalysisResultEventPayload,
  ModerationAction,
  ModerationLabel,
  ModerationEventPayload,
} from '@repo/dtos';
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

  async handleChatbotCrisisAlert(payload: any) {
    try {
      await this.proactiveInterventionService.evaluateFromChatbotCrisis(
        payload,
      );
    } catch (err) {
      this.logger.error(
        `Error during real-time proactive intervention evaluation for chatbot crisis alert, user=${payload.userId}`,
        err,
      );
    }
  }

  private async processEvent(payload: AnalysisResultEventPayload) {
    const moderation = payload.moderation;
    const isHardBlockedOrViolation =
      moderation?.action === ModerationAction.HARD_BLOCK ||
      Boolean(moderation?.isViolation);

    if (isHardBlockedOrViolation) {
      this.logger.log(
        `Removing analytics snapshot for violation/blocked target=${payload.targetId}`,
      );
      await this.model.deleteOne({
        targetId: payload.targetId,
        targetType: payload.targetType,
      });

      if (payload.userId) {
        await this.markUserDirty(payload.userId);
      }

      // Kiểm tra nếu KHÔNG PHẢI vụ việc sức khỏe tâm thần/tự hại thì mới return dừng lại
      const rawRiskStr = (payload.mentalHealthRiskLevel || '').toLowerCase();
      const isMentalHealthConcern =
        Boolean(moderation?.mentalHealthSupport) ||
        moderation?.label === ModerationLabel.SELF_HARM ||
        moderation?.label === ModerationLabel.EMOTIONAL_CRISIS ||
        rawRiskStr === 'critical' ||
        rawRiskStr === 'high';

      if (!isMentalHealthConcern) {
        return; // Vi phạm thuần túy (porn, violence, hate speech) -> dừng, không can thiệp
      }
    } else {
      // Bài viết hợp lệ -> lưu snapshot bình thường
      await this.upsertSnapshot(payload);
      await this.markUserDirty(payload.userId);
    }

    // Luôn kích hoạt can thiệp tâm lý (chạy cho cả bài viết hợp lệ lẫn các ca SELF_HARM/Crisis bị ẩn!)
    try {
      await this.proactiveInterventionService.evaluateFromEvent(
        payload.userId,
        payload,
      );
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
      mentalHealthRiskLevel: payload.mentalHealthRiskLevel ?? 'none',
      isSarcasmOrConflict: payload.isSarcasmOrConflict ?? false,
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
