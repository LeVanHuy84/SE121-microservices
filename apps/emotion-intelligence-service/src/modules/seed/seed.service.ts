import { Injectable, Logger } from '@nestjs/common';
import {
  AnalysisResultEventPayload,
  Emotion,
  LowCaseEmotion,
  TargetType,
} from '@repo/dtos';
import { IngestionService } from '../ingestion/ingestion.service';
import { SnapshotProcessor } from '../snapshot/snapshot.processor';
import { ProfileProcessor } from '../profile/profile.processor';
import { WarningProcessor } from '../warning/warning.processor';
import {
  GeneratedEmotionEvent,
  EmotionBehaviorProfile,
  EmotionGenerator,
} from './generators/emotion.generator';
import {
  TimelineGenerator,
  TimelinePoint,
  createSeededRandom,
} from './generators/timeline.generator';

export interface SeedAllOptions {
  deterministicSeed?: string | number;
  recomputeAfterSeed?: boolean;

  days?: number;
  batchSize?: number;
}

interface SeedUserProfile {
  userId: string;
  behavior: EmotionBehaviorProfile;
}

interface SeedRunResult {
  userId: string;
  eventCount: number;
  recomputed: boolean;
}

export interface SeedAllResult {
  users: SeedRunResult[];
}

const SEED_USERS: SeedUserProfile[] = [
  {
    userId: 'user_34yLamYI2RSWUhErS00oYpC9t50',
    behavior: 'positive',
  },
  {
    userId: 'user_34yMq1jl7bHiXM3YK6MtL6EO3sQ',
    behavior: 'downward',
  },
  {
    userId: 'user_37IIIyKObcAY2hLP15gwMnFryph',
    behavior: 'negative',
  },
];

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly ingestionService: IngestionService,
    private readonly snapshotProcessor: SnapshotProcessor,
    private readonly profileProcessor: ProfileProcessor,
    private readonly warningProcessor: WarningProcessor,
    private readonly emotionGenerator: EmotionGenerator,
    private readonly timelineGenerator: TimelineGenerator,
  ) {}

  async seedAll(options: SeedAllOptions = {}): Promise<SeedAllResult> {
    const now = new Date();
    const days = options.days ?? 3;
    const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const recomputeAfterSeed = options.recomputeAfterSeed ?? true;
    const batchSize = options.batchSize ?? 50;

    this.logger.log(`🌱 Start seeding (days=${days}, batch=${batchSize})`);

    // 🚀 chạy song song các user
    const results = await Promise.all(
      SEED_USERS.map(async (seedUser) => {
        const userRandom = createSeededRandom(
          `${options.deterministicSeed ?? now.getTime()}:${seedUser.userId}`,
        );

        const eventCount = userRandom.nextInt(20, 40);

        const timeline = this.timelineGenerator.buildTimeline({
          userId: seedUser.userId,
          startTime,
          endTime: now,
          eventCount,
          random: userRandom,
        });

        await this.seedUserEvents(seedUser, timeline, batchSize);

        if (recomputeAfterSeed) {
          await Promise.all([
            await this.snapshotProcessor.backfillUserSnapshots(seedUser.userId),
            this.profileProcessor.upsertUserProfile(seedUser.userId),
            this.warningProcessor.evaluateUsers([seedUser.userId]),
          ]);
        }

        return {
          userId: seedUser.userId,
          eventCount,
          recomputed: recomputeAfterSeed,
        };
      }),
    );

    this.logger.log(
      `✅ Seed completed for ${results.length} users (seed=${String(
        options.deterministicSeed ?? 'runtime',
      )})`,
    );

    return { users: results };
  }

  // ================= PRIVATE =================

  private async seedUserEvents(
    seedUser: SeedUserProfile,
    timeline: TimelinePoint[],
    batchSize: number,
  ): Promise<void> {
    for (let i = 0; i < timeline.length; i += batchSize) {
      const batch = timeline.slice(i, i + batchSize);

      await Promise.all(
        batch.map((point, index) => {
          const generated = this.emotionGenerator.generateEvent({
            userId: seedUser.userId,
            behavior: seedUser.behavior,
            createdAt: point.createdAt,
            index,
            totalEvents: timeline.length,
            random: point.random,
          });

          const payload = this.toAnalysisPayload(generated);
          return this.ingestionService.handleAnalysisResult(payload);
        }),
      );
    }
  }

  private toAnalysisPayload(
    generated: GeneratedEmotionEvent,
  ): AnalysisResultEventPayload {
    return {
      userId: generated.userId,
      targetId: generated.targetId,
      targetType: TargetType.POST,
      finalEmotion: this.toUpperEmotion(generated.finalEmotion),
      scores: generated.scores,
      confidence: generated.finalConfidence,
      intensityScore: Number((1 - generated.finalConfidence).toFixed(3)),
      riskHintLevel: this.resolveRiskHintLevel(generated.scores),
      createdAt: generated.createdAt,
    };
  }

  private toUpperEmotion(emotion: LowCaseEmotion): Emotion {
    switch (emotion) {
      case LowCaseEmotion.JOY:
        return Emotion.JOY;
      case LowCaseEmotion.SADNESS:
        return Emotion.SADNESS;
      case LowCaseEmotion.ANGER:
        return Emotion.ANGER;
      case LowCaseEmotion.FEAR:
        return Emotion.FEAR;
      case LowCaseEmotion.DISGUST:
        return Emotion.DISGUST;
      case LowCaseEmotion.SURPRISE:
        return Emotion.SURPRISE;
      case LowCaseEmotion.NEUTRAL:
      default:
        return Emotion.NEUTRAL;
    }
  }

  private resolveRiskHintLevel(scores: Record<LowCaseEmotion, number>): string {
    const negativeRatio =
      (scores[LowCaseEmotion.SADNESS] ?? 0) +
      (scores[LowCaseEmotion.ANGER] ?? 0) +
      (scores[LowCaseEmotion.FEAR] ?? 0);

    if (negativeRatio >= 0.7) return 'HIGH';
    if (negativeRatio >= 0.45) return 'MEDIUM';
    return 'LOW';
  }
}
