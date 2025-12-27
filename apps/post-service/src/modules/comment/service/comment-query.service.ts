import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CommentResponseDTO,
  GetCommentQueryDTO,
  PageResponse,
  ReactionType,
  TargetType,
} from '@repo/dtos';
import { Comment } from 'src/entities/comment.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { Repository, In } from 'typeorm';
import { CommentCacheService } from './comment-cache.service';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class CommentQueryService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>,
    private readonly commentCache: CommentCacheService
  ) {}

  /** 🔹 Tìm comment theo ID (ưu tiên cache) */
  async findById(
    userRequestId: string,
    commentId: string
  ): Promise<CommentResponseDTO> {
    // ⚡ Lấy từ cache nếu có
    let comment = await this.commentCache.getCachedComment(commentId);
    if (!comment) {
      comment = await this.commentRepo.findOne({
        where: { id: commentId },
        relations: ['commentStat'],
      });
      if (!comment || comment.isDeleted)
        throw new RpcException({
          statusCode: 404,
          message: 'Comment not found',
        });
      await this.commentCache.setCachedComment(comment);
    }

    // 🔹 Lấy reaction user
    const reaction = await this.reactionRepo.findOne({
      where: {
        userId: userRequestId,
        targetType: TargetType.COMMENT,
        targetId: commentId,
      },
      select: ['reactionType'],
    });

    const dto = plainToInstance(CommentResponseDTO, comment, {
      excludeExtraneousValues: true,
    });
    dto.isOwner = comment.userId === userRequestId;
    dto.reactedType = reaction?.reactionType ?? undefined;

    return dto;
  }

  /** 🔹 Lấy danh sách comment (theo rootId hoặc parentId) */
  async findByQuery(
    userRequestId: string,
    query: GetCommentQueryDTO
  ): Promise<PageResponse<CommentResponseDTO>> {
    const { page, limit, rootId, rootType, parentId } = query;

    // ⚡ Trang đầu thường xuyên truy cập → cache
    if (page === 1) {
      const cachedList = await this.commentCache.getCachedCommentList(
        rootId,
        parentId
      );
      if (cachedList) {
        const reactionMap = await this.getReactionMap(
          userRequestId,
          cachedList.map((c) => c.id)
        );
        const dtoList = cachedList.map((c) =>
          this.mapToCommentDTO(c, userRequestId, reactionMap)
        );
        return new PageResponse(dtoList, cachedList.length, page, limit);
      }
    }

    // 🔹 Query DB
    const qb = this.commentRepo
      .createQueryBuilder('c')
      .where('c.isDeleted = false')
      .leftJoinAndSelect('c.commentStat', 'stat')
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (parentId) {
      qb.andWhere('c.parentId = :parentId', { parentId });
    } else if (rootId && rootType !== undefined && rootType !== null) {
      qb.andWhere('c.rootId = :rootId', { rootId })
        .andWhere('c.rootType = :rootType', { rootType })
        .andWhere('c.parentId IS NULL');
    } else {
      // Không đủ điều kiện → trả rỗng
      return new PageResponse([], 0, page, limit);
    }

    const [comments, total] = await qb.getManyAndCount();
    if (!comments.length) return new PageResponse([], 0, page, limit);

    // 🔹 Cache lại nếu là trang đầu
    if (page === 1) {
      await this.commentCache.setCachedCommentList(comments, rootId, parentId);
    }

    const commentIds = comments.map((c) => c.id);
    const reactionMap = await this.getReactionMap(userRequestId, commentIds);

    const dtoList = comments.map((c) =>
      this.mapToCommentDTO(c, userRequestId, reactionMap)
    );

    return new PageResponse(dtoList, total, page, limit);
  }

  /** 🧩 Helper: Map entity -> DTO */
  private mapToCommentDTO(
    comment: Comment,
    userId: string,
    reactionMap: Map<string, ReactionType | undefined>
  ): CommentResponseDTO {
    return {
      id: comment.id,
      userId: comment.userId,
      rootType: comment.rootType,
      rootId: comment.rootId,
      parentId: comment.parentId,
      content: comment.content,
      media: comment.media,
      commentStat: comment.commentStat,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      isOwner: comment.userId === userId,
      reactedType: reactionMap.get(comment.id),
    };
  }

  /** 🔹 Helper: Lấy reaction hàng loạt */
  private async getReactionMap(
    userId: string,
    ids: string[]
  ): Promise<Map<string, ReactionType | undefined>> {
    if (!ids.length) return new Map();
    const reactions = await this.reactionRepo.find({
      where: { userId, targetType: TargetType.COMMENT, targetId: In(ids) },
      select: ['targetId', 'reactionType'],
    });
    return new Map(reactions.map((r) => [r.targetId, r.reactionType]));
  }
}
