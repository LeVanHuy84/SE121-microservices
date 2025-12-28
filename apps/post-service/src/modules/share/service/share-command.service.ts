import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Audience,
  CreateShareDTO,
  ShareResponseDTO,
  UpdateShareDTO,
  EventTopic,
  ShareEventType,
  RootType,
  TargetType,
  StatsEventType,
  EventDestination,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { PostStat } from 'src/entities/post-stat.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { Share } from 'src/entities/share.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Post } from 'src/entities/post.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { Comment } from 'src/entities/comment.entity';
import { EntityManager, Repository } from 'typeorm';
import { ShareCacheService } from './share-cache.service';
import { StatsBufferService } from 'src/modules/stats/stats.buffer.service';
import { ShareShortenMapper } from '../share-shorten.mapper';
import { RecentActivityBufferService } from 'src/modules/event/recent-activity.buffer.service';

@Injectable()
export class ShareCommandService {
  constructor(
    @InjectRepository(Share)
    private readonly shareRepo: Repository<Share>,
    private readonly shareCache: ShareCacheService,
    private readonly statsBuffer: StatsBufferService,
    private readonly recentActivityBuffer: RecentActivityBufferService
  ) {}

  /**
   * 🟢 Create a new share of a public post.
   */
  async sharePost(
    userId: string,
    dto: CreateShareDTO
  ): Promise<ShareResponseDTO> {
    const savedShare = await this.shareRepo.manager.transaction(
      async (manager) => {
        const post = await manager.findOne(Post, {
          where: { id: dto.postId },
          relations: ['postGroupInfo'],
        });

        if (
          !post ||
          post.audience !== Audience.PUBLIC ||
          post.postGroupInfo?.isPrivateGroup
        ) {
          throw new RpcException({
            statusCode: 400,
            message: `Can't share this post`,
          });
        }

        // ✅ Tạo entity Share và ShareStat
        const share = manager.create(Share, {
          ...dto,
          userId,
          post,
          shareStat: manager.create(ShareStat, {}),
        });

        const saved = await manager.save(share);

        // ✅ Gom các tác vụ độc lập vào mảng promises
        const promises: Promise<any>[] = [];

        if (saved.audience === Audience.PUBLIC) {
          // Cập nhật thống kê DB và buffer song song
          promises.push(this.updateStatsForPost(manager, dto.postId, +1));
        }

        if (saved.audience !== Audience.ONLY_ME) {
          // Gửi event outbox cho hệ thống khác (Feed / Kafka)
          const snapshot = ShareShortenMapper.toShareSnapshotEvent(saved);
          const outbox = manager.create(OutboxEvent, {
            topic: EventTopic.SHARE,
            destination: EventDestination.KAFKA,
            eventType: ShareEventType.CREATED,
            payload: snapshot,
          });
          promises.push(manager.save(outbox));
        }

        // ✅ Chạy tất cả các tác vụ song song (trong transaction)
        await Promise.all(promises);

        return saved;
      }
    );

    // 🔹 Các tác vụ async nhẹ sau transaction (không cần rollback nếu lỗi)
    this.statsBuffer
      .updateStat(TargetType.POST, dto.postId, StatsEventType.SHARE, +1)
      .catch(console.error);

    this.recentActivityBuffer
      .addRecentActivity({
        idempotentKey: savedShare.id,
        actorId: userId,
        type: 'share',
        targetType: TargetType.POST,
        targetId: dto.postId,
      })
      .catch(console.error);

    // 🔹 Trả về kết quả DTO gọn nhẹ
    return plainToInstance(ShareResponseDTO, savedShare, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * ✏️ Update content of a share.
   */
  async update(
    userId: string,
    shareId: string,
    dto: Partial<UpdateShareDTO>
  ): Promise<ShareResponseDTO> {
    const share = await this.shareRepo.findOne({
      where: { id: shareId },
      relations: ['post', 'shareStat'],
    });
    if (!share)
      throw new RpcException({
        statusCode: 404,
        message: 'Share not found',
      });
    if (share.userId !== userId)
      throw new RpcException({
        statusCode: 403,
        message: 'Unauthorized',
      });

    const oldAudience = share.audience;
    Object.assign(share, dto);
    const updatedShare = await this.shareRepo.save(share);

    await this.shareCache.removeCache(shareId);

    // 🧮 Nếu audience thay đổi, cập nhật thống kê
    if (oldAudience !== updatedShare.audience && share.postId) {
      const delta =
        updatedShare.audience === Audience.PUBLIC
          ? +1
          : oldAudience === Audience.PUBLIC
            ? -1
            : 0;

      if (delta !== 0) {
        await this.updateStatsForPost(
          this.shareRepo.manager,
          share.postId,
          delta
        );
        await this.statsBuffer.updateStat(
          TargetType.POST,
          share.postId,
          StatsEventType.SHARE,
          delta
        );
      }
    }

    // 🔹 Outbox event for feed update
    await this.shareRepo.manager.save(
      this.shareRepo.manager.create(OutboxEvent, {
        topic: EventTopic.SHARE,
        destination: EventDestination.KAFKA,
        eventType: ShareEventType.UPDATED,
        payload: { shareId, content: dto.content },
      })
    );

    return plainToInstance(ShareResponseDTO, updatedShare, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * ❌ Remove a share and update post stats.
   */
  async remove(userId: string, shareId: string): Promise<boolean> {
    return await this.shareRepo.manager.transaction(async (manager) => {
      const share = await manager.findOne(Share, {
        where: { id: shareId },
        relations: ['post'],
      });

      if (!share)
        throw new RpcException({
          statusCode: 404,
          message: 'Share not found',
        });
      if (share.userId !== userId)
        throw new RpcException({
          statusCode: 403,
          message: 'Unauthorized',
        });

      // Xóa reactions, comments thuộc share
      await manager
        .createQueryBuilder()
        .delete()
        .from(Reaction)
        .where('target_id = :shareId AND target_type = :targetType', {
          shareId,
          targetType: TargetType.SHARE,
        })
        .execute();

      await manager
        .createQueryBuilder()
        .delete()
        .from(Comment)
        .where('root_target_id = :shareId AND root_target_type = :rootType', {
          shareId,
          rootType: RootType.SHARE,
        })
        .execute();

      await manager.delete(Share, { id: shareId });

      // 🔹 Update DB + Redis stat cho post gốc (chỉ nếu share công khai)
      if (share.postId && share.audience === Audience.PUBLIC) {
        await this.updateStatsForPost(manager, share.postId, -1);
        await this.statsBuffer.updateStat(
          TargetType.POST,
          share.postId,
          StatsEventType.SHARE,
          -1
        );
      }

      await this.shareCache.removeCache(shareId);

      const outbox = manager.create(OutboxEvent, {
        topic: EventTopic.SHARE,
        destination: EventDestination.KAFKA,
        eventType: ShareEventType.REMOVED,
        payload: { shareId },
      });
      await manager.save(outbox);

      return true;
    });
  }

  /**
   * 🧮 Helper: update post's share count (DB).
   */
  private async updateStatsForPost(
    manager: EntityManager,
    postId: string,
    delta: number
  ) {
    await manager
      .getRepository(PostStat)
      .createQueryBuilder()
      .update()
      .set({ shares: () => `"shares" + ${delta}` })
      .where('postId = :postId', { postId })
      .execute();
  }
}
