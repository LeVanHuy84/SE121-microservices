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
import { plainToInstance } from 'class-transformer';
import { Comment } from 'src/entities/comment.entity';
import { Reaction } from 'src/entities/reaction.entity';
import { In, Repository } from 'typeorm';

@Injectable()
export class CommentQueryService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepo: Repository<Comment>,
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>
  ) {}

  /** 🔹 Tìm comment theo ID */
  async findById(
    userRequestId: string,
    commentId: string
  ): Promise<CommentResponseDTO> {
    const comment = await this.commentRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.commentStat', 'stat')
      .where('c.id = :commentId', { commentId })
      .getOne();

    if (!comment) throw new RpcException('Comment not found');

    const userReaction = await this.reactionRepo.findOne({
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
    dto.reactedType = userReaction?.reactionType ?? undefined;

    return dto;
  }

  /** 🔹 Lấy danh sách comment theo rootId / parentId */
  async findByQuery(
    userRequestId: string,
    query: GetCommentQueryDTO
  ): Promise<PageResponse<CommentResponseDTO>> {
    const { page, limit, rootId, rootType, parentId } = query;

    const qb = this.commentRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.commentStat', 'stat')
      .orderBy('c.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (parentId) {
      qb.andWhere('c.parentId = :parentId', { parentId });
    } else if (rootId && rootType) {
      qb.andWhere('c.rootId = :rootId', { rootId })
        .andWhere('c.rootType = :rootType', { rootType })
        .andWhere('c.parentId IS NULL');
    } else {
      return new PageResponse<CommentResponseDTO>([], 0, page, limit);
    }

    const [comments, total] = await qb.getManyAndCount();
    if (!comments.length) {
      return new PageResponse<CommentResponseDTO>([], 0, page, limit);
    }

    const commentIds = comments.map((c) => c.id);

    // 🔹 Lấy reaction của user
    const reactions = await this.reactionRepo
      .createQueryBuilder('r')
      .select(['r.targetId', 'r.reactionType'])
      .where('r.userId = :userId', { userId: userRequestId })
      .andWhere('r.targetType = :targetType', {
        targetType: TargetType.COMMENT,
      })
      .andWhere('r.targetId IN (:...ids)', { ids: commentIds })
      .getRawMany<{ r_targetId: string; r_reactionType: ReactionType }>();

    const reactionMap = new Map<string, ReactionType | undefined>(
      reactions.map((r) => [r.r_targetId, r.r_reactionType])
    );

    const dtoList = comments.map((c) =>
      this.mapToCommentDTO(c, userRequestId, reactionMap)
    );

    return new PageResponse<CommentResponseDTO>(dtoList, total, page, limit);
  }

  /** 🧩 Helper: Map comment entity -> DTO với context user */
  private mapToCommentDTO(
    comment: Comment,
    userRequestId: string,
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
      isOwner: comment.userId === userRequestId,
      reactedType: reactionMap.get(comment.id),
    };
  }
}
