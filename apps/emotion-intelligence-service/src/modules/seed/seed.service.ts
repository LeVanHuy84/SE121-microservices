import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import * as path from 'path';
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
  EmotionGenerator,
} from './generators/emotion.generator';
import {
  TimelineGenerator,
  TimelinePoint,
  createSeededRandom,
} from './generators/timeline.generator';
import { loadUsersFromJSON, SeedUserProfile } from './generators/loadUser';

export interface SeedAllOptions {
  deterministicSeed?: string | number;
  recomputeAfterSeed?: boolean;
  days?: number;
  batchSize?: number;
}

interface SeedRunResult {
  userId: string;
  eventCount: number;
  recomputed: boolean;
}

export interface SeedAllResult {
  users: SeedRunResult[];
}

const SEED_BEHAVIOR_PLAN: readonly SeedUserProfile['behavior'][] = [
  'positive',
  'downward',
  'negative',
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

    const seedUsers = (await loadUsersFromJSON(this.resolveSeedUsersFilePath()))
      .slice(0, 3)
      .map((seedUser, index) => ({
        ...seedUser,
        behavior:
          SEED_BEHAVIOR_PLAN[index] ??
          SEED_BEHAVIOR_PLAN[SEED_BEHAVIOR_PLAN.length - 1],
      }));

    this.logger.log(
      `👥 Loaded ${seedUsers.length} users from seed-data/data/generated-users.json`,
    );

    const stats = { positive: 0, downward: 0, negative: 0 };
    seedUsers.forEach((u) => stats[u.behavior]++);
    this.logger.log(`Behavior distribution: ${JSON.stringify(stats)}`);

    const totalUsers = seedUsers.length;
    let processedUsers = 0;
    let failedUsers = 0;
    const start = Date.now();

    const results = await Promise.all(
      seedUsers.map(async (seedUser) => {
        const userStart = Date.now();

        try {
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
              this.snapshotProcessor.backfillUserSnapshots(seedUser.userId),
              this.profileProcessor.upsertUserProfile(seedUser.userId),
              this.warningProcessor.evaluateUsers([seedUser.userId]),
            ]);
          }

          processedUsers++;

          const elapsed = (Date.now() - start) / 1000;
          const avg = elapsed / processedUsers;
          const remaining = totalUsers - processedUsers;
          const eta = (remaining * avg).toFixed(1);

          const duration = ((Date.now() - userStart) / 1000).toFixed(2);

          this.logger.log(
            `[${processedUsers}/${totalUsers}] user=${seedUser.userId} (${eventCount} events, ${duration}s) | ETA: ${eta}s`,
          );

          return {
            userId: seedUser.userId,
            eventCount,
            recomputed: recomputeAfterSeed,
          };
        } catch (err) {
          failedUsers++;

          const errorMessage = err instanceof Error ? err.message : String(err);

          this.logger.error(`user=${seedUser.userId} failed: ${errorMessage}`);

          throw err; // giữ nguyên behavior Promise.all
        }
      }),
    );

    this.logger.log(
      `DONE: success=${processedUsers}, failed=${failedUsers}, total=${totalUsers}`,
    );

    return { users: results };
  }

  // ================= PRIVATE =================

  private async seedUserEvents(
    seedUser: SeedUserProfile,
    timeline: TimelinePoint[],
    batchSize: number,
  ): Promise<void> {
    const total = timeline.length;
    let processed = 0;

    for (let i = 0; i < total; i += batchSize) {
      const batch = timeline.slice(i, i + batchSize);

      await Promise.all(
        batch.map((point, index) => {
          const generated = this.emotionGenerator.generateEvent({
            userId: seedUser.userId,
            behavior: seedUser.behavior,
            createdAt: point.createdAt,
            index,
            totalEvents: total,
            random: point.random,
          });

          const payload = this.toAnalysisPayload(generated);
          return this.ingestionService.handleAnalysisResult(payload);
        }),
      );

      processed += batch.length;

      // log nhẹ, không spam
      if (processed === total || processed >= total / 2) {
        this.logger.debug(
          `   ↳ ${seedUser.userId}: ${processed}/${total} events`,
        );
      }
    }
  }

  private resolveSeedUsersFilePath(): string {
    const candidatePaths = [
      // path.resolve(process.cwd(), 'seed-data/data/generated-users.json'),
      // path.resolve(process.cwd(), '../../seed-data/data/generated-users.json'),
      path.join(__dirname, 'users.json'),
    ];

    for (const candidatePath of candidatePaths) {
      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    return candidatePaths[0];
  }

  private toAnalysisPayload(
    generated: GeneratedEmotionEvent,
  ): AnalysisResultEventPayload {
    return {
      userId: generated.userId,
      targetId: generated.targetId,
      targetType: TargetType.POST,
      modelVersion: 'v1.0.1',
      primaryEmotion: this.toUpperEmotion(generated.finalEmotion),
      secondaryEmotions: [],
      scores: generated.scores,
      confidence: generated.finalConfidence,
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
