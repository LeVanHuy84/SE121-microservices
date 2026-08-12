import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CursorPageResponse,
  DisReactDTO,
  EventDestination,
  EventTopic,
  GetReactionsDTO,
  InteractionEventPayload,
  InteractionType,
  ReactDTO,
  ReactionResponseDTO,
  ReactionType,
  RootType,
  StatsEventType,
  TargetType,
  NotiOutboxPayload,
  NotiTargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { ReactionFieldMap } from 'src/constant';
import { ShareStat } from 'src/entities/share-stat.entity';
import { Post } from 'src/entities/post.entity';
import { Comment } from 'src/entities/comment.entity';
import { Share } from 'src/entities/share.entity';
import { UserClientService } from '../client/user-client.service';
import { StatsBufferService } from '../stats/stats.buffer.service';
import { RecentActivityBufferService } from '../event/recent-activity.buffer.service';

@Injectable()
export class ReactionService {
  private readonly statRepoMap = {
    [TargetType.POST]: PostStat,
    [TargetType.COMMENT]: CommentStat,
    [TargetType.SHARE]: ShareStat,
  };

  constructor(
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>,
    private readonly dataSource: DataSource,
    private readonly statBuffer: StatsBufferService,
    private readonly recentActivityBuffer: RecentActivityBufferService,
    private readonly userClient: UserClientService,
  ) {}

  // --------------------------------------------------
  // 🧩 Lấy danh sách reaction (dùng QueryBuilder)
  // --------------------------------------------------
  async getReactions(
    dto: GetReactionsDTO,
  ): Promise<CursorPageResponse<ReactionResponseDTO>> {
    const qb = this.reactionRepo
      .createQueryBuilder('r')
      .where('r.targetId = :targetId', { targetId: dto.targetId })
      .andWhere('r.targetType = :targetType', { targetType: dto.targetType });

    if (dto.reactionType) {
      qb.andWhere('r.reactionType = :reactionType', {
        reactionType: dto.reactionType,
      });
    }

    qb.orderBy('r.createdAt', 'DESC').take(dto.limit + 1);

    if (dto.cursor) {
      qb.andWhere('r.createdAt < :cursor', { cursor: dto.cursor });
    }

    const reactions = await qb.getMany();

    const hasNextPage = reactions.length > dto.limit;
    const data = reactions.slice(0, dto.limit);

    const nextCursor = hasNextPage
      ? data[data.length - 1].createdAt.toISOString()
      : null;

    const reactionDTOs = plainToInstance(ReactionResponseDTO, data, {
      excludeExtraneousValues: true,
    });

    return new CursorPageResponse<ReactionResponseDTO>(
      reactionDTOs,
      nextCursor,
      hasNextPage,
    );
  }

  // --------------------------------------------------
  // ❤️ React
  // --------------------------------------------------
  async react(userId: string, dto: ReactDTO): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Reaction);

      const existing = await repo.findOne({
        where: { userId, targetId: dto.targetId, targetType: dto.targetType },
      });

      if (!existing) {
        await this.createReaction(manager, userId, dto);
        if (dto.targetType !== TargetType.COMMENT) {
          const interactionPayload: InteractionEventPayload = {
            userId: userId,
            targetType:
              dto.targetType === TargetType.POST
                ? RootType.POST
                : RootType.SHARE,
            targetId: dto.targetId,
            interactionType: InteractionType.REACT,
            createdAt: new Date(),
          };

          const interactionOutbox = manager.create(OutboxEvent, {
            topic: EventTopic.INTERACTION,
            destination: EventDestination.KAFKA,
            eventType: 'user.interaction',
            payload: interactionPayload,
          });

          await manager.save(interactionOutbox);
        }

        await this.createReactionNotificationEvent(
          manager,
          userId,
          dto.targetType,
          dto.targetId,
        );

        return {
          buffer: [{ delta: +1, type: dto.reactionType }],
          isNew: true,
        };
      }

      if (existing.reactionType === dto.reactionType) {
        return { buffer: null, isNew: false };
      }

      await this.switchReaction(manager, existing, dto.reactionType);
      return {
        buffer: [
          { delta: -1, type: existing.reactionType },
          { delta: +1, type: dto.reactionType },
        ],
        isNew: false,
      };
    });

    if (dto.targetType !== TargetType.POST) return true;

    const updates = result.buffer?.map((b) => ({
      type: StatsEventType.REACTION,
      delta: b.delta,
      subType: ReactionType[b.type],
    }));

    await Promise.allSettled([
      updates
        ? this.statBuffer.updateMultipleStats(
            dto.targetType,
            dto.targetId,
            updates,
          )
        : Promise.resolve(),
      result.isNew
        ? this.recentActivityBuffer.addRecentActivity({
            idempotentKey: `${userId}:${dto.targetType}:${dto.targetId}`,
            actorId: userId,
            type: 'reaction',
            targetType: dto.targetType,
            targetId: dto.targetId,
          })
        : Promise.resolve(),
    ]);

    return true;
  }

  // --------------------------------------------------
  // 💔 DisReact
  // --------------------------------------------------
  async disReact(userId: string, dto: DisReactDTO): Promise<boolean> {
    const result = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Reaction);

      const deleted = await repo
        .createQueryBuilder()
        .delete()
        .from(Reaction)
        .where('userId = :userId', { userId })
        .andWhere('targetId = :targetId', { targetId: dto.targetId })
        .andWhere('targetType = :targetType', { targetType: dto.targetType })
        .returning('reaction_type')
        .execute();

      if (!deleted.affected || !deleted.raw[0]) return null;

      const reactionType = deleted.raw[0].reaction_type as ReactionType;
      await this.updateStatsWithManager(
        manager,
        dto.targetType,
        dto.targetId,
        reactionType,
        -1,
      );

      return { buffer: { delta: -1, type: reactionType } };
    });

    if (dto.targetType === TargetType.POST && result?.buffer) {
      await this.statBuffer.updateStat(
        dto.targetType,
        dto.targetId,
        StatsEventType.REACTION,
        result.buffer.delta,
        ReactionType[result.buffer.type],
      );
    }

    return true;
  }

  // --------------------------------------------------
  // Get reactedType batch by userId + targetIds
  // --------------------------------------------------
  async getReactedTypesBatch(
    userId: string,
    targetType: TargetType,
    targetIds: string[],
  ): Promise<Record<string, ReactionType>> {
    if (!targetIds.length) return {};
    const reactions = await this.reactionRepo.find({
      where: { userId, targetId: In(targetIds), targetType },
    });
    return Object.fromEntries(
      reactions.map((r) => [r.targetId, r.reactionType]),
    );
  }

  // --------------------------------------------------
  // 🔧 Helpers
  // --------------------------------------------------

  private async createReaction(
    manager: EntityManager,
    userId: string,
    dto: ReactDTO,
  ) {
    const repo = manager.getRepository(Reaction);
    await repo.save(
      repo.create({
        userId,
        targetId: dto.targetId,
        targetType: dto.targetType,
        reactionType: dto.reactionType,
      }),
    );

    await this.updateStatsWithManager(
      manager,
      dto.targetType,
      dto.targetId,
      dto.reactionType,
      +1,
    );
  }

  private async switchReaction(
    manager: EntityManager,
    existing: Reaction,
    newType: ReactionType,
  ) {
    await this.updateStatsWithManager(
      manager,
      existing.targetType,
      existing.targetId,
      existing.reactionType,
      -1,
    );

    existing.reactionType = newType;
    await manager.getRepository(Reaction).save(existing);

    await this.updateStatsWithManager(
      manager,
      existing.targetType,
      existing.targetId,
      newType,
      +1,
    );
  }

  private async updateStatsWithManager(
    manager: EntityManager,
    targetType: TargetType,
    targetId: string,
    reactionType: ReactionType,
    delta: number,
  ) {
    const field = ReactionFieldMap[reactionType];
    const repoClass = this.statRepoMap[targetType];
    if (!repoClass) throw new Error(`Unsupported target type: ${targetType}`);

    await manager
      .getRepository(repoClass)
      .createQueryBuilder()
      .update()
      .set({
        [field]: () => `"${field}" + ${delta}`,
        reactions: () => `"reactions" + ${delta}`,
      })
      .where(`${targetType.toLowerCase()}Id = :id`, { id: targetId })
      .execute();
  }

  private async createReactionNotificationEvent(
    manager: EntityManager,
    userId: string,
    targetType: TargetType,
    targetId: string,
  ): Promise<OutboxEvent | null> {
    let ownerId: string | undefined;

    switch (targetType) {
      case TargetType.POST: {
        const post = await manager.findOne(Post, {
          where: { id: targetId },
          select: ['userId'],
        });
        ownerId = post?.userId;
        break;
      }
      case TargetType.COMMENT: {
        const comment = await manager.findOne(Comment, {
          where: { id: targetId },
          select: ['userId'],
        });
        ownerId = comment?.userId;
        break;
      }
      case TargetType.SHARE: {
        const share = await manager.findOne(Share, {
          where: { id: targetId },
          select: ['userId'],
        });
        ownerId = share?.userId;
        break;
      }
    }

    if (!ownerId || ownerId === userId) return null; // Không tự thông báo cho mình

    const actor = await this.userClient.getUserInfo(userId);

    const notiPayload: NotiOutboxPayload = {
      targetId,
      targetType:
        targetType === TargetType.POST
          ? NotiTargetType.POST
          : targetType === TargetType.SHARE
            ? NotiTargetType.SHARE
            : NotiTargetType.POST,
      actorName: `${actor?.lastName ?? ''} ${actor?.firstName ?? ''}`.trim(),
      actorAvatar: actor?.avatarUrl,
      content: '', // Template service có thể tự build content
      receivers: [ownerId],
    };

    const outbox = manager.create(OutboxEvent, {
      topic: 'notification',
      eventType: 'reaction',
      destination: EventDestination.RABBITMQ,
      payload: notiPayload,
    });

    return manager.save(outbox);
  }
}
