import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AdminModerationQuery,
  AppealStatus,
  CommentResponseDTO,
  ContentModerationDTO,
  FinalDecision,
  GetMyModerationQuery,
  ModerationRecordDetailDTO,
  PageResponse,
  PostResponseDTO,
  ShareResponseDTO,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { Comment } from 'src/entities/comment.entity';
import { ContentModeration } from 'src/entities/content-moderation.entity';
import { Post } from 'src/entities/post.entity';
import { Share } from 'src/entities/share.entity';
import { In, Repository } from 'typeorm';
import { LogService } from './log.service';

@Injectable()
export class ModerationService {
  constructor(
    @InjectRepository(ContentModeration)
    private readonly contentModerationRepository: Repository<ContentModeration>,
    @InjectRepository(Post) private readonly postRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Share)
    private readonly shareRepository: Repository<Share>,
    private readonly logService: LogService,
  ) {}

  async getMyModerationRecords(
    userId: string,
    query: GetMyModerationQuery,
  ): Promise<PageResponse<ContentModerationDTO>> {
    const { targetType, page = 1, limit = 10 } = query;

    const [records, total] =
      await this.contentModerationRepository.findAndCount({
        where: { userId, targetType },
        order: { createdAt: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      });

    // group ids
    const postIds: string[] = [];
    const commentIds: string[] = [];
    const shareIds: string[] = [];

    for (const r of records) {
      if (r.targetType === TargetType.POST) postIds.push(r.targetId);
      else if (r.targetType === TargetType.COMMENT) commentIds.push(r.targetId);
      else if (r.targetType === TargetType.SHARE) shareIds.push(r.targetId);
    }

    // batch query (FIX TYPE)
    const posts: Post[] = postIds.length
      ? await this.postRepository.find({
          where: { id: In(postIds) },
        })
      : [];

    const comments: Comment[] = commentIds.length
      ? await this.commentRepository.find({
          where: { id: In(commentIds) },
        })
      : [];

    const shares: Share[] = shareIds.length
      ? await this.shareRepository.find({
          where: { id: In(shareIds) },
        })
      : [];

    // map (FIX tuple type)
    const postMap = new Map<string, Post>(
      posts.map((p): [string, Post] => [p.id, p]),
    );

    const commentMap = new Map<string, Comment>(
      comments.map((c): [string, Comment] => [c.id, c]),
    );

    const shareMap = new Map<string, Share>(
      shares.map((s): [string, Share] => [s.id, s]),
    );

    // build response
    const items = records.map((r) => {
      let preview: ContentModerationDTO['targetPreview'] | undefined;

      if (r.targetType === TargetType.POST) {
        const post = postMap.get(r.targetId);
        preview = {
          content: post?.content?.slice(0, 100),
          imageUrl: post?.media?.[0],
        };
      }

      if (r.targetType === TargetType.COMMENT) {
        const comment = commentMap.get(r.targetId);
        preview = {
          content: comment?.content?.slice(0, 100),
          imageUrl: comment?.media,
        };
      }

      if (r.targetType === TargetType.SHARE) {
        const share = shareMap.get(r.targetId);
        preview = {
          content: share?.content?.slice(0, 100),
        };
      }

      return {
        ...r,
        targetPreview: preview,
      };
    });

    return new PageResponse(
      plainToInstance(ContentModerationDTO, items),
      total,
      page,
      limit,
    );
  }

  async getModerationRecordDetail(
    id: string,
  ): Promise<ModerationRecordDetailDTO> {
    const moderation = await this.contentModerationRepository.findOne({
      where: { id },
    });

    if (!moderation) {
      throw new RpcException('Moderation record not found');
    }

    let target: PostResponseDTO | CommentResponseDTO | ShareResponseDTO | null =
      null;

    if (moderation.targetType === TargetType.POST) {
      const post = await this.postRepository.findOne({
        where: { id: moderation.targetId },
      });
      target = plainToInstance(PostResponseDTO, post);
    }

    if (moderation.targetType === TargetType.COMMENT) {
      const comment = await this.commentRepository.findOne({
        where: { id: moderation.targetId },
      });
      target = plainToInstance(CommentResponseDTO, comment);
    }

    if (moderation.targetType === TargetType.SHARE) {
      const share = await this.shareRepository.findOne({
        where: { id: moderation.targetId },
      });
      target = plainToInstance(ShareResponseDTO, share);
    }

    return {
      moderation: plainToInstance(ContentModerationDTO, moderation),
      target,
    };
  }

  async getModerationRecordsByAdmin(
    query: AdminModerationQuery,
  ): Promise<PageResponse<ContentModerationDTO>> {
    const {
      targetType,
      maxSeverity,
      finalDecision,
      fromDate,
      toDate,
      page = 1,
      limit = 10,
    } = query;

    const qb = this.contentModerationRepository.createQueryBuilder('cm');

    if (targetType) {
      qb.andWhere('cm.target_type = :targetType', { targetType });
    }

    if (maxSeverity) {
      qb.andWhere('cm.max_severity = :maxSeverity', { maxSeverity });
    }

    if (finalDecision) {
      qb.andWhere('cm.final_decision = :finalDecision', { finalDecision });
    }

    if (fromDate) {
      qb.andWhere('cm.created_at >= :fromDate', { fromDate });
    }

    if (toDate) {
      qb.andWhere('cm.created_at <= :toDate', { toDate });
    }

    qb.orderBy('cm.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [records, total] = await qb.getManyAndCount();

    // =========================
    // attach preview
    // =========================

    const postIds: string[] = [];
    const commentIds: string[] = [];
    const shareIds: string[] = [];

    for (const r of records) {
      if (r.targetType === TargetType.POST) postIds.push(r.targetId);
      else if (r.targetType === TargetType.COMMENT) commentIds.push(r.targetId);
      else if (r.targetType === TargetType.SHARE) shareIds.push(r.targetId);
    }

    const [posts, comments, shares] = await Promise.all([
      postIds.length
        ? this.postRepository.find({ where: { id: In(postIds) } })
        : [],
      commentIds.length
        ? this.commentRepository.find({ where: { id: In(commentIds) } })
        : [],
      shareIds.length
        ? this.shareRepository.find({ where: { id: In(shareIds) } })
        : [],
    ]);

    const postMap = new Map<string, Post>(
      posts.map((p): [string, Post] => [p.id, p]),
    );

    const commentMap = new Map<string, Comment>(
      comments.map((c): [string, Comment] => [c.id, c]),
    );

    const shareMap = new Map<string, Share>(
      shares.map((s): [string, Share] => [s.id, s]),
    );

    const items = records.map((r) => {
      let preview: ContentModerationDTO['targetPreview'] | undefined;

      if (r.targetType === TargetType.POST) {
        const post = postMap.get(r.targetId);
        preview = {
          content: post?.content?.slice(0, 100),
          imageUrl: post?.media?.[0],
        };
      }

      if (r.targetType === TargetType.COMMENT) {
        const comment = commentMap.get(r.targetId);
        preview = {
          content: comment?.content?.slice(0, 100),
          imageUrl: comment?.media,
        };
      }

      if (r.targetType === TargetType.SHARE) {
        const share = shareMap.get(r.targetId);
        preview = {
          content: share?.content?.slice(0, 100),
        };
      }

      return {
        ...r,
        targetPreview: preview,
      };
    });

    return new PageResponse(
      plainToInstance(ContentModerationDTO, items),
      total,
      page,
      limit,
    );
  }

  async applyFinalDecision(
    moderationId: string,
    appealStatus: AppealStatus,
    isAppealProcess = false,
    moderatorId?: string,
  ): Promise<ContentModerationDTO> {
    const moderation = await this.contentModerationRepository.findOne({
      where: { id: moderationId },
    });

    if (!moderation) {
      throw new RpcException('Moderation record not found');
    }

    // =========================================================
    // determine final decision + content state
    // =========================================================

    const isApproved = appealStatus === AppealStatus.APPROVED;

    const finalDecision = isApproved
      ? FinalDecision.NO_VIOLATION
      : FinalDecision.VIOLATION;

    const isDeleted = !isApproved;

    // =========================================================
    // update target content
    // =========================================================

    if (moderation.targetType === TargetType.POST) {
      await this.postRepository.update(moderation.targetId, {
        isDeleted,
      });
    }

    if (moderation.targetType === TargetType.COMMENT) {
      await this.commentRepository.update(moderation.targetId, {
        isDeleted,
      });
    }

    if (moderation.targetType === TargetType.SHARE) {
      await this.shareRepository.update(moderation.targetId, {
        isDeleted,
      });
    }

    // =========================================================
    // update moderation final decision
    // =========================================================

    await this.contentModerationRepository.update(moderationId, {
      finalDecision,
    });

    // =========================================================
    // return updated moderation
    // =========================================================

    const updatedModeration = await this.contentModerationRepository.findOne({
      where: { id: moderationId },
    });

    // Log the admin's final decision action (only for appeal process)
    if (!isAppealProcess) {
      await this.logService.logAdminFinalDecision(
        moderatorId!,
        moderationId,
        appealStatus,
      );
    }

    return plainToInstance(ContentModerationDTO, updatedModeration);
  }
}
