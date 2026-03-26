import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  StatsPayload,
  StatsEventType,
  TargetType,
  StatsReactionDelta,
  StatsCommentDelta,
  StatsShareDelta,
} from '@repo/dtos';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PostSnapshot,
  PostSnapshotDocument,
} from 'src/mongo/schema/post-snapshot.schema';
import {
  ShareSnapshot,
  ShareSnapshotDocument,
} from 'src/mongo/schema/share-snapshot.schema';

@Injectable()
export class StatsIngestionService {
  private readonly logger = new Logger(StatsIngestionService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectModel(PostSnapshot.name)
    private readonly postSnapshotModel: Model<PostSnapshotDocument>,
    @InjectModel(ShareSnapshot.name)
    private readonly shareSnapshotModel: Model<ShareSnapshotDocument>,
  ) {}

  /**
   * Xử lý batch thống kê từ Kafka (StatsPayload)
   */
  async processStatsBatch(message: StatsPayload) {
    const { timestamp, stats } = message;
    const pipeline = this.redis.pipeline();

    for (const record of stats) {
      const { targetType, targetId, deltas, isTrendingCandidate } = record;

      // --- Cập nhật điểm xếp hạng Redis (chỉ cho POST) ---
      if (isTrendingCandidate && deltas.length > 0) {
        const metaKey = `post:meta:${targetId}`;
        const engagementKey = `post:engagement:${targetId}`;

        for (const delta of deltas) {
          if (delta.type === StatsEventType.REACTION) {
            pipeline.hincrby(engagementKey, 'reactions', delta.delta);
          } else if (delta.type === StatsEventType.COMMENT) {
            pipeline.hincrby(engagementKey, 'comments', delta.delta);
          } else if (delta.type === StatsEventType.SHARE) {
            pipeline.hincrby(engagementKey, 'shares', delta.delta);
          }
        }

        // mark dirty
        pipeline.sadd('post:dirty', targetId);
        pipeline.hset(metaKey, 'lastStatAt', timestamp);
        pipeline.expire(metaKey, 2592000); // 30 ngày
        pipeline.expire(engagementKey, 2592000); // 30 ngày
      }

      // --- Cập nhật snapshot trong MongoDB ---
      await this.updateSnapshotStats(targetType, targetId, deltas);
    }

    await pipeline.exec();

    this.logger.log(
      `✅ Updated ${stats.length} records (POST/SHARE) from StatsPayload.`,
    );
  }

  private async updateSnapshotStats(
    targetType: TargetType,
    targetId: string,
    deltas: (StatsReactionDelta | StatsCommentDelta | StatsShareDelta)[],
  ) {
    const updates: Record<string, number> = {};

    for (const delta of deltas) {
      if (delta.type === StatsEventType.REACTION) {
        // Ví dụ: reactionType = LIKE → field = stats.likes
        const field = `stats.${delta.reactionType.toLowerCase()}s`;
        updates[field] = (updates[field] ?? 0) + delta.delta;

        // Tổng số reaction cũng tăng
        updates['stats.reactions'] =
          (updates['stats.reactions'] ?? 0) + delta.delta;
      } else if (delta.type === StatsEventType.COMMENT) {
        updates['stats.comments'] =
          (updates['stats.comments'] ?? 0) + delta.delta;
      } else if (delta.type === StatsEventType.SHARE) {
        updates['stats.shares'] = (updates['stats.shares'] ?? 0) + delta.delta;
      }
    }

    // Không có gì thay đổi thì bỏ qua
    if (Object.keys(updates).length === 0) return;

    // Chọn model theo loại snapshot
    if (targetType === TargetType.POST) {
      await this.postSnapshotModel.updateOne(
        { postId: targetId },
        { $inc: updates },
      );
    } else if (targetType === TargetType.SHARE) {
      await this.shareSnapshotModel.updateOne(
        { shareId: targetId },
        { $inc: updates },
      );
    }
  }
}
