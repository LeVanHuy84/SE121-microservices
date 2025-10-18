import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CommentResponseDTO,
  CreateCommentDTO,
  RootType,
  TargetType,
  UpdateCommentDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { Comment } from 'src/entities/comment.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { ShareStat } from 'src/entities/share-stat.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CommentCacheService } from './comment-cache.service';

@Injectable()
export class CommentService {
  constructor(
    @InjectRepository(Comment) private commentRepo: Repository<Comment>,
    private readonly dataSource: DataSource,
    private readonly commentCache: CommentCacheService
  ) {}

  async create(
    userId: string,
    dto: CreateCommentDTO
  ): Promise<CommentResponseDTO> {
    return this.dataSource.transaction(async (manager) => {
      const comment = manager.create(Comment, {
        ...dto,
        userId,
        commentStat: manager.create(CommentStat, {}),
      });

      const entity = await manager.save(comment);

      await this.updateStatsForComment(
        manager,
        dto.rootType,
        dto.rootId,
        dto.parentId,
        +1
      );

      return plainToInstance(CommentResponseDTO, entity, {
        excludeExtraneousValues: true,
      });
    });
  }

  async update(
    userId: string,
    commentId: string,
    dto: UpdateCommentDTO
  ): Promise<CommentResponseDTO> {
    const comment = await this.commentRepo.findOne({
      where: { id: commentId },
    });
    if (!comment) {
      throw new RpcException(`Comment with id ${commentId} not found`);
    }

    if (comment.userId !== userId) {
      throw new RpcException('You are not allowed to update this comment');
    }

    comment.content = dto.content;
    await this.commentRepo.save(comment);

    // 🧹 Xoá cache liên quan
    await this.commentCache.invalidateComment(comment.rootId, comment.parentId);

    return plainToInstance(CommentResponseDTO, comment, {
      excludeExtraneousValues: true,
    });
  }

  async remove(id: string) {
    return this.dataSource.transaction(async (manager) => {
      const comment = await manager.findOne(Comment, { where: { id } });
      if (!comment) {
        throw new RpcException(`Comment with id ${id} not found`);
      }

      await manager.delete(Reaction, {
        targetType: TargetType.COMMENT,
        targetId: id,
      });

      await manager.remove(comment);

      await this.updateStatsForComment(
        manager,
        comment.rootType,
        comment.rootId,
        comment.parentId,
        -1
      );

      // 🧹 Xoá cache liên quan
      await this.commentCache.invalidateComment(
        comment.rootId,
        comment.parentId
      );

      return { message: 'Comment deleted successfully' };
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
}
