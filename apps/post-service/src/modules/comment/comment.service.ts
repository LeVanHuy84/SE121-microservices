import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CommentResponseDto,
  CreateCommentDto,
  GetCommentQueryDto,
  PageResponse,
  UpdateCommentDto,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { CommentStat } from 'src/entities/comment-stat.entity';
import { Comment } from 'src/entities/comment.entity';
import { PostStat } from 'src/entities/post-stat.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';

@Injectable()
export class CommentService {
  constructor(
    @InjectRepository(Comment) private commentRepo: Repository<Comment>,
    private readonly dataSource: DataSource
  ) {}

  async create(
    userId: string,
    dto: CreateCommentDto
  ): Promise<CommentResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const comment = manager.create(Comment, {
        ...dto,
        userId,
        commentStat: manager.create(CommentStat, {}),
      });

      const entity = await manager.save(comment);

      await this.updateStatsForComment(manager, dto.postId, dto.replyId, +1);

      return plainToInstance(CommentResponseDto, entity, {
        excludeExtraneousValues: true,
      });
    });
  }

  async getCommentById(commentId: string): Promise<CommentResponseDto> {
    const comment = await this.commentRepo.findOneBy({ id: commentId });

    if (!comment) {
      throw new RpcException(`Comment with id ${commentId} not found`);
    }

    return plainToInstance(CommentResponseDto, comment, {
      excludeExtraneousValues: true,
    });
  }

  async getComments(
    query: GetCommentQueryDto
  ): Promise<PageResponse<CommentResponseDto>> {
    const { page, limit, postId, replyId } = query;

    const qb = this.commentRepo
      .createQueryBuilder('c')
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (postId && !replyId) {
      qb.andWhere('c.postId = :postId', { postId }).andWhere(
        'c.replyId IS NULL'
      );
    } else {
      qb.andWhere('c.replyId = :replyId', { replyId });
    }

    const [comments, total] = await qb.getManyAndCount();

    const data = comments.map((c) =>
      plainToInstance(CommentResponseDto, c, { excludeExtraneousValues: true })
    );

    return new PageResponse<CommentResponseDto>(data, total, page, limit);
  }

  async update(
    userId: string,
    commentId: string,
    dto: UpdateCommentDto
  ): Promise<CommentResponseDto> {
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

    return plainToInstance(CommentResponseDto, comment, {
      excludeExtraneousValues: true,
    });
  }

  async delete(id: string) {
    return this.dataSource.transaction(async (manager) => {
      const comment = await manager.findOne(Comment, { where: { id } });
      if (!comment) {
        throw new RpcException(`Comment with id ${id} not found`);
      }

      await manager.remove(comment);

      await this.updateStatsForComment(
        manager,
        comment.postId,
        comment.replyId,
        -1
      );

      return { message: 'Comment deleted successfully' };
    });
  }

  private async updateStatsForComment(
    manager: EntityManager,
    postId: string,
    replyId?: string,
    delta: number = 1
  ) {
    if (replyId) {
      await manager
        .getRepository(CommentStat)
        .createQueryBuilder()
        .update()
        .set({
          replies: () => `"replies" + ${delta}`,
        })
        .where('commentId = :commentId', { commentId: replyId })
        .execute();
    }

    await manager
      .getRepository(PostStat)
      .createQueryBuilder()
      .update()
      .set({
        comments: () => `"comments" + ${delta}`,
      })
      .where('postId = :postId', { postId })
      .execute();
  }
}
