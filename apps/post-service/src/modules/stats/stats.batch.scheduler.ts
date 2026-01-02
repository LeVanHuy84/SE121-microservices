import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StatsBufferService } from './stats.buffer.service';
import {
  Audience,
  EventDestination,
  EventTopic,
  ReactionType,
  StatsCommentDelta,
  StatsEventType,
  StatsPayload,
  StatsReactionDelta,
  StatsShareDelta,
  TargetType,
} from '@repo/dtos';
import { InjectRepository } from '@nestjs/typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { In, Repository } from 'typeorm';
import { Post } from 'src/entities/post.entity';

@Injectable()
export class StatsBatchScheduler {
  private readonly logger = new Logger(StatsBatchScheduler.name);

  constructor(
    private readonly buffer: StatsBufferService,
    @InjectRepository(OutboxEvent)
    private readonly outboxRepo: Repository<OutboxEvent>,
    @InjectRepository(Post)
    private readonly postRepo: Repository<Post>
  ) {
    console.log('🔥 StatsBatchScheduler initialized');
  }

  @Cron('*/10 * * * * *') // mỗi 10 giây
  async flushStatsToKafka() {
    const allStats = await this.buffer.getAllBufferedStats();
    const payload: StatsPayload = {
      timestamp: Date.now(),
      stats: [],
    };

    const clearedBuffers: { targetType: TargetType; targetId: string }[] = [];

    // 🔹 Thu toàn bộ postId cần check trending
    const postIdsToCheck = new Set<string>();

    if (allStats[TargetType.POST]) {
      for (const targetId of Object.keys(allStats[TargetType.POST])) {
        postIdsToCheck.add(targetId);
      }
    }

    // 🔹 Query 1 phát các post (chỉ field cần thiết)
    const posts = postIdsToCheck.size
      ? await this.postRepo.find({
          where: {
            id: In(Array.from(postIdsToCheck)),
            isDeleted: false,
          },
          select: ['id', 'groupId'],
        })
      : [];

    const postMap = new Map(posts.map((p) => [p.id, p]));

    // 🔹 Xử lý stats
    for (const targetType of Object.values(TargetType)) {
      const entries = allStats[targetType];
      if (!entries) continue;

      for (const [targetId, fields] of Object.entries(entries)) {
        const deltas = Object.entries(fields).map(([key, value]) => {
          if (key.startsWith(StatsEventType.REACTION)) {
            const [, reactionType] = key.split(':');
            return {
              type: StatsEventType.REACTION,
              reactionType: reactionType as ReactionType,
              delta: Number(value),
            } as const satisfies StatsReactionDelta;
          } else if (key === StatsEventType.COMMENT) {
            return {
              type: StatsEventType.COMMENT,
              delta: Number(value),
            } as const satisfies StatsCommentDelta;
          } else if (key === StatsEventType.SHARE) {
            return {
              type: StatsEventType.SHARE,
              delta: Number(value),
            } as const satisfies StatsShareDelta;
          } else {
            throw new Error(`Unknown stat key: ${key}`);
          }
        });

        let isTrendingCandidate = false;

        if (targetType === TargetType.POST) {
          const post = postMap.get(targetId);
          // ✅ CHỈ post thường (không group, không deleted)
          isTrendingCandidate =
            !!post &&
            post.groupId == null &&
            post.isDeleted === false &&
            post.audience === Audience.PUBLIC;
        }

        payload.stats.push({
          targetType,
          targetId,
          deltas,
          isTrendingCandidate,
        });

        clearedBuffers.push({ targetType, targetId });
      }
    }

    if (!payload.stats.length) return;

    const outboxEvent = this.outboxRepo.create({
      topic: EventTopic.STATS,
      destination: EventDestination.KAFKA,
      eventType: 'stats.batch',
      payload,
    });

    await this.outboxRepo.save(outboxEvent);
    await this.buffer.clearMultipleBuffers(clearedBuffers);

    this.logger.log(
      `✅ Flushed ${payload.stats.length} stat records (${clearedBuffers.length} buffers) to Kafka.`
    );
  }
}
