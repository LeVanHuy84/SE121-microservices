// src/services/reaction.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DisReactDTO,
  GetReactionsDTO,
  ReactDTO,
  ReactionResponseDTO,
  ReactionType,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { Reaction } from 'src/entities/reaction.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { ReactionFieldMap } from 'src/constant';
import { ShareStat } from 'src/entities/share-stat.entity';

@Injectable()
export class ReactionService {
  constructor(
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>,
    private readonly dataSource: DataSource
  ) {}

  async getReactions(dto: GetReactionsDTO) {
    const [reactions, total] = await this.reactionRepo.findAndCount({
      where: { targetId: dto.targetId, targetType: dto.targetType },
      skip: (dto.page - 1) * dto.limit,
      take: dto.limit,
    });

    const reactionDTOs = plainToInstance(ReactionResponseDTO, reactions, {
      excludeExtraneousValues: true,
    });

    return { data: reactionDTOs, total, page: dto.page, limit: dto.limit };
  }

  async react(userId: string, dto: ReactDTO) {
    console.log('React called');
    return this.dataSource.transaction(async (manager) => {
      const reactionRepo = manager.getRepository(Reaction);

      const existing = await reactionRepo.findOne({
        where: { userId, targetId: dto.targetId, targetType: dto.targetType },
      });

      if (existing) {
        // Nếu đổi reaction
        console.log('Existing reaction found:', existing);
        if (existing.reactionType !== dto.reactionType) {
          await this.updateStatsWithManager(
            manager,
            dto.targetType,
            dto.targetId,
            existing.reactionType,
            -1
          );
          // Update reaction
          existing.reactionType = dto.reactionType;
          await reactionRepo.save(existing);
          await this.updateStatsWithManager(
            manager,
            dto.targetType,
            dto.targetId,
            dto.reactionType,
            +1
          );
        }
      } else {
        console.log('No existing reaction, creating new one');
        await reactionRepo.save(
          reactionRepo.create({
            userId,
            targetId: dto.targetId,
            targetType: dto.targetType,
            reactionType: dto.reactionType,
          })
        );
        await this.updateStatsWithManager(
          manager,
          dto.targetType,
          dto.targetId,
          dto.reactionType,
          +1
        );
      }
    });
  }

  async disReact(userId: string, dto: DisReactDTO) {
    return this.dataSource.transaction(async (manager) => {
      const reactionRepo = manager.getRepository(Reaction);

      // Xoá và lấy lại loại reaction
      const deleted = await reactionRepo
        .createQueryBuilder()
        .delete()
        .from(Reaction)
        .where('userId = :userId', { userId })
        .andWhere('targetId = :targetId', { targetId: dto.targetId })
        .andWhere('targetType = :targetType', { targetType: dto.targetType })
        .returning('reaction_type') // field trong DB
        .execute();

      if (deleted.affected && deleted.raw[0]) {
        const reactionType = deleted.raw[0].reaction_type as ReactionType;
        await this.updateStatsWithManager(
          manager,
          dto.targetType,
          dto.targetId,
          reactionType,
          -1
        );
      }
    });
  }

  private async updateStatsWithManager(
    manager: EntityManager,
    targetType: TargetType,
    targetId: string,
    reactionType: ReactionType,
    delta: number
  ) {
    const field = ReactionFieldMap[reactionType];

    console.log('Updating stats:', {
      targetType,
      targetId,
      reactionType,
      delta,
    });

    const updateQuery = {
      [field]: () => `"${field}" + ${delta}`,
      reactions: () => `"reactions" + ${delta}`,
    };

    switch (targetType) {
      case TargetType.POST:
        await manager
          .getRepository(PostStat)
          .createQueryBuilder()
          .update()
          .set(updateQuery)
          .where('postId = :id', { id: targetId })
          .execute();
        break;

      case TargetType.COMMENT:
        await manager
          .getRepository(CommentStat)
          .createQueryBuilder()
          .update()
          .set(updateQuery)
          .where('commentId = :id', { id: targetId })
          .execute();
        break;

      case TargetType.SHARE:
        await manager
          .getRepository(ShareStat)
          .createQueryBuilder()
          .update()
          .set(updateQuery)
          .where('shareId = :id', { id: targetId })
          .execute();
        break;

      default:
        throw new Error(`Unsupported target type: ${targetType}`);
    }
  }
}
