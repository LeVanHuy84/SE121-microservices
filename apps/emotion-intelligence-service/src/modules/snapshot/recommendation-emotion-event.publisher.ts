import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EmotionTimeWindow } from '@repo/dtos';
import { Kafka, Producer } from 'kafkajs';
import { SnapshotRepository } from './snapshot.repository';

@Injectable()
export class RecommendationEmotionEventPublisher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    RecommendationEmotionEventPublisher.name,
  );
  private producer: Producer | null = null;
  private topic = process.env.RECOMMENDATION_EMOTION_TOPIC?.trim();

  constructor(private readonly snapshotRepository: SnapshotRepository) {}

  async onModuleInit() {
    const brokers = process.env.KAFKA_BROKERS?.split(',').map((value) =>
      value.trim(),
    );
    if (!this.topic || !brokers || brokers.length === 0) {
      this.logger.warn(
        'Recommendation emotion publisher disabled due to missing Kafka config',
      );
      return;
    }

    const kafka = new Kafka({
      clientId:
        process.env.KAFKA_CLIENT_ID?.trim() ?? 'emotion-intelligence-service',
      brokers,
    });
    this.producer = kafka.producer();
    await this.producer.connect();
    this.logger.log(
      `Recommendation emotion publisher connected topic=${this.topic}`,
    );
  }

  async onModuleDestroy() {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
  }

  @OnEvent('snapshot.updated')
  async handleSnapshotUpdated(event: { userId: string; timestamp: string }) {
    if (!this.producer || !this.topic) {
      return;
    }

    const userId = String(event?.userId ?? '').trim();
    if (!userId) {
      return;
    }

    const snapshot = await this.snapshotRepository.getLatestSnapshot(
      userId,
      EmotionTimeWindow.SEVEN_DAYS,
    );
    if (!snapshot) {
      return;
    }

    const finalScores =
      typeof snapshot.emotionDistribution === 'object' &&
      snapshot.emotionDistribution
        ? snapshot.emotionDistribution
        : {};

    const dominantEmotion = this.resolveDominantEmotion(finalScores);
    const payload = {
      userId,
      riskScore: Number(snapshot.riskScore ?? 0),
      recentNegativityScore: Number(snapshot.negativeRatio ?? 0),
      dominantEmotion,
      finalScores,
      occurredAt:
        snapshot.createdAt instanceof Date
          ? snapshot.createdAt.toISOString()
          : event.timestamp,
      source: 'emotion-intelligence-service',
      schemaVersion: 1,
    };

    await this.producer.send({
      topic: this.topic,
      messages: [
        {
          key: userId,
          value: JSON.stringify({
            type: 'recommendation.emotion.profile-updated',
            payload,
          }),
        },
      ],
    });
  }

  private resolveDominantEmotion(
    scores: Record<string, number>,
  ): string | null {
    let dominantEmotion: string | null = null;
    let dominantScore = Number.NEGATIVE_INFINITY;

    for (const [emotion, score] of Object.entries(scores)) {
      const normalizedScore = Number(score);
      if (!Number.isFinite(normalizedScore)) {
        continue;
      }
      if (normalizedScore > dominantScore) {
        dominantScore = normalizedScore;
        dominantEmotion = emotion;
      }
    }

    return dominantEmotion;
  }
}
