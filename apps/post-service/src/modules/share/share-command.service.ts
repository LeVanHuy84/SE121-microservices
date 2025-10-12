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
  MediaItemDTO,
  RootType,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { PostStat } from 'src/entities/post-stat.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { Share } from 'src/entities/share.entity';
import { EntityManager, Repository } from 'typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Post } from 'src/entities/post.entity';
import { Reaction } from 'src/entities/reaction.entity';

@Injectable()
export class ShareCommandService {
  constructor(
    @InjectRepository(Share)
    private readonly shareRepo: Repository<Share>
  ) {}

  /**
   * Create a new share of a public post.
   */
  async sharePost(
    userId: string,
    dto: CreateShareDTO
  ): Promise<ShareResponseDTO> {
    return await this.shareRepo.manager.transaction(async (manager) => {
      const post = await manager.findOne(Post, {
        where: { id: dto.postId },
      });

      if (!post || post.audience !== Audience.PUBLIC) {
        throw new RpcException(`Can't share this post`);
      }

      const share = manager.create(Share, {
        ...dto,
        userId,
        post,
        shareStat: manager.create(ShareStat, {}),
      });

      const savedShare = await manager.save(share);

      await this.updateStatsForPost(manager, dto.postId, +1);

      // build snapshot nhẹ của post (feed cần)
      const postSnapshot = this.buildPostSnapshot(post);

      // ghi OutboxEvent để Kafka consumer xử lý sau
      const outbox = manager.create(OutboxEvent, {
        topic: EventTopic.SHARE,
        eventType: ShareEventType.CREATED,
        payload: {
          shareId: savedShare.id,
          userId,
          content: savedShare.content,
          post: postSnapshot,
          createdAt: savedShare.createdAt,
        },
      });
      await manager.save(outbox);

      return plainToInstance(ShareResponseDTO, savedShare, {
        excludeExtraneousValues: true,
      });
    });
  }

  /**
   * Update content of a share.
   */
  async update(
    userId: string,
    shareId: string,
    dto: UpdateShareDTO
  ): Promise<ShareResponseDTO> {
    const share = await this.shareRepo.findOneBy({ id: shareId });
    if (!share) throw new RpcException('Share not found');
    if (share.userId !== userId) throw new RpcException('Unauthorized');

    Object.assign(share, dto);
    const updatedShare = await this.shareRepo.save(share);

    // Lưu event outbox
    await this.shareRepo.manager.save(
      this.shareRepo.manager.create(OutboxEvent, {
        eventType: ShareEventType.UPDATED,
        payload: {
          topic: EventTopic.SHARE,
          type: ShareEventType.UPDATED,
          payload: {
            shareId,
            content: dto.content,
          },
        },
      })
    );

    return plainToInstance(ShareResponseDTO, updatedShare, {
      excludeExtraneousValues: true,
    });
  }

  /**
   * Remove a share and update post stats.
   */
  async remove(userId: string, shareId: string) {
    return await this.shareRepo.manager.transaction(async (manager) => {
      const share = await manager.findOne(Share, {
        where: { id: shareId },
      });

      if (!share) throw new RpcException('Share not found');
      if (share.userId !== userId) throw new RpcException('Unauthorized');

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

      if (share.postId) {
        await this.updateStatsForPost(manager, share.postId, -1);
      }

      const outbox = manager.create(OutboxEvent, {
        topic: EventTopic.SHARE,
        eventType: ShareEventType.REMOVED,
        payload: { shareId },
      });
      await manager.save(outbox);

      return { success: true };
    });
  }

  /**
   * Helper: update post's share count.
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

  /**
   * Helper: build lightweight post snapshot for event payload.
   */
  private buildPostSnapshot(post: Post) {
    let mediaPreviews: MediaItemDTO[] | undefined;
    let mediaRemaining: number | undefined;

    if (Array.isArray(post.media) && post.media.length > 0) {
      mediaPreviews = post.media.slice(0, 5);
      mediaRemaining = Math.max(0, post.media.length - 5);
    }

    return {
      postId: post.id,
      userId: post.userId,
      groupId: post.groupId ?? undefined,
      content: post.content,
      mediaPreviews,
      mediaRemaining,
      createdAt: post.createdAt,
    };
  }
}
