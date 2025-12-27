import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  CommentResponseDTO,
  CreateCommentDTO,
  EventDestination,
  EventTopic,
  MediaDeleteItem,
  MediaEventPayloads,
  MediaEventType,
  MediaType,
  NotiOutboxPayload,
  NotiTargetType,
  RootType,
  StatsEventType,
  TargetType,
  UpdateCommentDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { Comment } from 'src/entities/comment.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { DataSource, EntityManager } from 'typeorm';
import { CommentCacheService } from './comment-cache.service';
import { StatsBufferService } from 'src/modules/stats/stats.buffer.service';
import { RecentActivityBufferService } from 'src/modules/event/recent-activity.buffer.service';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { UserClientService } from 'src/modules/client/user/user-client.service';
import { OutboxService } from 'src/modules/event/outbox.service';
import { Post } from 'src/entities/post.entity';
import { Share } from 'src/entities/share.entity';

@Injectable()
export class CommentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly commentCache: CommentCacheService,
    private readonly statsBuffer: StatsBufferService,
    private readonly recentActivityBuffer: RecentActivityBufferService,
    private readonly userClient: UserClientService,
    private readonly outboxService: OutboxService
  ) {}

  async create(
    userId: string,
    dto: CreateCommentDTO
  ): Promise<CommentResponseDTO> {
    // 🧩 Transaction đảm bảo toàn vẹn dữ liệu
    const savedComment = await this.dataSource.transaction(async (manager) => {
      // ✅ 1. Tạo comment & stat
      const comment = manager.create(Comment, {
        ...dto,
        userId,
        commentStat: manager.create(CommentStat, {}),
      });

      const entity = await manager.save(comment);

      // ✅ 2. Cập nhật thống kê comment gốc (Post/Share + parent)
      const updateStatsPromise = this.updateStatsForComment(
        manager,
        dto.rootType,
        dto.rootId,
        dto.parentId,
        +1
      );

      // ✅ 3. Nếu là reply → chuẩn bị outbox event cho thông báo
      let outboxPromise: Promise<any> | null = null;
      if (dto.parentId) {
        outboxPromise = this.createReplyNotificationEvent(
          manager,
          entity,
          dto.parentId
        );
      }

      const analysisOutbox = this.outboxService.createAnalysisEvent(
        manager,
        TargetType.COMMENT,
        entity
      );

      // ✅ 4. Chạy song song các tác vụ không phụ thuộc
      await Promise.all(
        [updateStatsPromise, outboxPromise, analysisOutbox].filter(Boolean)
      );

      return entity;
    });

    // 🧠 5. Các thao tác async nhẹ sau transaction (không cần rollback)
    this.recentActivityBuffer
      .addRecentActivity({
        idempotentKey: savedComment.id,
        actorId: userId,
        type: 'comment',
        targetId: dto.rootId,
        targetType:
          dto.rootType === RootType.POST ? TargetType.POST : TargetType.SHARE,
      })
      .catch(console.error);

    this.statsBuffer
      .updateStat(
        dto.rootType === RootType.POST ? TargetType.POST : TargetType.SHARE,
        dto.rootId,
        StatsEventType.COMMENT,
        +1
      )
      .catch(console.error);

    // ✅ 6. Trả kết quả
    return plainToInstance(CommentResponseDTO, savedComment, {
      excludeExtraneousValues: true,
    });
  }

  async update(
    userId: string,
    commentId: string,
    dto: UpdateCommentDTO
  ): Promise<CommentResponseDTO> {
    return await this.dataSource.transaction(async (manager) => {
      const commentRepo = manager.getRepository(Comment);
      // 1️⃣ Tìm comment
      const comment = await commentRepo.findOne({ where: { id: commentId } });
      if (!comment) {
        throw new RpcException({
          statusCode: 404,
          message: `Comment with id ${commentId} not found`,
        });
      }

      // 2️⃣ Kiểm tra quyền
      if (comment.userId !== userId) {
        throw new RpcException({
          statusCode: 403,
          message: 'You are not allowed to update this comment',
        });
      }

      // 3️⃣ Cập nhật nội dung
      comment.content = dto.content;
      await commentRepo.save(comment);

      await this.outboxService.updatedAnalysisEvent(
        manager,
        TargetType.COMMENT,
        commentId,
        dto.content
      );

      // 4️⃣ Xoá cache (sau transaction)
      await this.commentCache.invalidateComment(
        comment.id,
        comment.rootId,
        comment.parentId
      );

      // 5️⃣ Trả về DTO
      return plainToInstance(CommentResponseDTO, comment, {
        excludeExtraneousValues: true,
      });
    });
  }

  async remove(userId: string, commentId: string) {
    return this.dataSource.transaction(async (manager) => {
      const comment = await manager.findOne(Comment, {
        where: { id: commentId },
      });

      if (!comment) {
        throw new RpcException({
          statusCode: 404,
          message: `Comment with id ${commentId} not found`,
        });
      }

      // Nếu không phải chủ comment thì check quyền theo root
      if (comment.userId !== userId) {
        let ownerId: string | undefined;

        switch (comment.rootType) {
          case RootType.POST: {
            const post = await manager.findOne(Post, {
              where: { id: comment.rootId },
              select: ['userId'],
            });
            ownerId = post?.userId;
            break;
          }

          case RootType.SHARE: {
            const share = await manager.findOne(Share, {
              where: { id: comment.rootId },
              select: ['userId'],
            });
            ownerId = share?.userId;
            break;
          }

          default:
            throw new RpcException({
              statusCode: 403,
              message: 'You are not allowed to delete this comment',
            });
        }

        if (ownerId !== userId) {
          throw new RpcException({
            statusCode: 403,
            message: 'You are not allowed to delete this comment',
          });
        }
      }

      let mediaPayload:
        | MediaEventPayloads[MediaEventType.DELETE_REQUESTED]
        | null = null;

      if (comment.media && comment.media.publicId) {
        const item: MediaDeleteItem = {
          publicId: comment.media.publicId,
          resourceType:
            comment.media.type === MediaType.IMAGE ? 'image' : 'video',
        };

        mediaPayload = { items: [item] };
      }

      await manager.delete(Reaction, {
        targetType: TargetType.COMMENT,
        targetId: commentId,
      });

      await manager.remove(comment);

      await this.updateStatsForComment(
        manager,
        comment.rootType,
        comment.rootId,
        comment.parentId,
        -1
      );

      await this.statsBuffer.updateStat(
        comment.rootType === RootType.POST ? TargetType.POST : TargetType.SHARE,
        comment.rootId,
        StatsEventType.COMMENT,
        -1
      );

      if (mediaPayload) {
        const mediaOutbox = manager.create(OutboxEvent, {
          topic: EventTopic.MEDIA,
          destination: EventDestination.KAFKA,
          eventType: MediaEventType.DELETE_REQUESTED,
          payload: mediaPayload,
        });

        await manager.save(mediaOutbox);
      }

      await this.commentCache.invalidateComment(
        comment.id,
        comment.rootId,
        comment.parentId
      );

      return true;
    });
  }

  private async updateStatsForComment(
    manager: EntityManager,
    rootType: RootType,
    rootId: string,
    parentId?: string,
    delta: number = 1
  ) {
    if (parentId) {
      await manager
        .getRepository(CommentStat)
        .createQueryBuilder()
        .update()
        .set({
          replies: () => `"replies" + ${delta}`,
        })
        .where('commentId = :commentId', { commentId: parentId })
        .execute();
    }

    switch (rootType) {
      case RootType.POST:
        await manager
          .getRepository(PostStat)
          .createQueryBuilder()
          .update()
          .set({
            comments: () => `"comments" + ${delta}`,
          })
          .where('postId = :postId', { postId: rootId })
          .execute();
        break;
      case RootType.SHARE:
        await manager
          .getRepository(ShareStat)
          .createQueryBuilder()
          .update()
          .set({
            comments: () => `"comments" + ${delta}`,
          })
          .where('shareId = :shareId', { shareId: rootId })
          .execute();
        break;
      default:
        break;
    }
  }

  /**
   * Tạo outbox event cho reply comment.
   * (Tách riêng cho gọn và dễ test)
   */
  private async createReplyNotificationEvent(
    manager: EntityManager,
    entity: Comment,
    parentId: string
  ): Promise<OutboxEvent> {
    const [actor, parentComment] = await Promise.all([
      this.userClient.getUserInfo(entity.userId),
      manager.findOne(Comment, { select: ['userId'], where: { id: parentId } }),
    ]);

    if (!parentComment?.userId) throw new Error('Parent comment not found');

    const notiPayload: NotiOutboxPayload = {
      targetId: entity.rootId,
      targetType:
        entity.rootType === RootType.POST
          ? NotiTargetType.POST
          : NotiTargetType.SHARE,
      actorName: `${actor?.lastName ?? ''} ${actor?.firstName ?? ''}`.trim(),
      actorAvatar: actor?.avatarUrl,
      content: entity.content.slice(0, 100),
      receivers: [parentComment.userId],
    };

    const outbox = manager.create(OutboxEvent, {
      topic: 'notification',
      eventType: 'reply_comment',
      destination: EventDestination.RABBITMQ,
      payload: notiPayload,
    });

    return manager.save(outbox);
  }
}
