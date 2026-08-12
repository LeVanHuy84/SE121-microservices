import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  AdminAppealQuery,
  AdminAppealQueueItemDTO,
  AppealStatus,
  CreateAdminReviewAppealDTO,
  CreateAppealRequestDTO,
  EventDestination,
  EventTopic,
  LogType,
  ModerationAppealResponseDTO,
  PageResponse,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { ContentModeration } from 'src/entities/content-moderation.entity';
import { ModerationAppeal } from 'src/entities/moderation-appeal.entity';
import { In, Repository } from 'typeorm';
import { ModerationService } from './moderation.service';
import { Post } from 'src/entities/post.entity';
import { Share } from 'src/entities/share.entity';
import { Comment } from 'src/entities/comment.entity';
import { ModerationAppealMapper } from './moderation.mapper';
import { LogService } from './log.service';

@Injectable()
export class ModerationAppealService {
  constructor(
    @InjectRepository(ContentModeration)
    private readonly contentModerationRepository: Repository<ContentModeration>,
    @InjectRepository(ModerationAppeal)
    private readonly moderationAppealRepository: Repository<ModerationAppeal>,
    private readonly moderationService: ModerationService,
    @InjectRepository(Post) private readonly postRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Share)
    private readonly shareRepository: Repository<Share>,
    private readonly logService: LogService,
  ) {}

  async createAppeal(
    userId: string,
    createAppealDTO: CreateAppealRequestDTO,
  ): Promise<ModerationAppealResponseDTO> {
    const { moderationId, reason } = createAppealDTO;
    const moderation = await this.contentModerationRepository.findOne({
      where: { id: moderationId },
    });

    if (!moderation) {
      throw new RpcException('Moderation record not found');
    }

    if (moderation.userId !== userId) {
      throw new RpcException('You are not authorized to appeal this record');
    }

    const existingAppeal = await this.moderationAppealRepository.findOne({
      where: { moderationId, userId, status: AppealStatus.PENDING },
    });

    if (existingAppeal) {
      throw new RpcException(
        'You already have a pending appeal for this moderation record',
      );
    }

    const appeal = this.moderationAppealRepository.create({
      moderationId,
      userId,
      reason,
    });

    const savedAppeal = await this.moderationAppealRepository.save(appeal);

    return plainToInstance(ModerationAppealResponseDTO, savedAppeal);
  }

  async adminReviewAppeal(
    moderatorId: string,
    appealId: string,
    reviewResult: CreateAdminReviewAppealDTO,
  ): Promise<ModerationAppealResponseDTO> {
    const { status, reviewNote } = reviewResult;
    const appeal = await this.moderationAppealRepository.findOne({
      where: { id: appealId },
    });

    if (!appeal) {
      throw new RpcException('Appeal not found');
    }

    await this.moderationService.applyFinalDecision(
      appeal.moderationId,
      status,
      true,
    );

    appeal.status = status;
    appeal.reviewNote = reviewNote ?? '';
    appeal.reviewedAt = new Date();
    appeal.reviewedBy = moderatorId;

    await this.moderationAppealRepository.save(appeal);

    // Log the admin's review action
    await this.logService.logAdminReviewAppeal(moderatorId, appeal.id, status);

    return plainToInstance(ModerationAppealResponseDTO, appeal);
  }

  async getListAppeal(
    query: AdminAppealQuery,
  ): Promise<PageResponse<AdminAppealQueueItemDTO>> {
    const { status, page = 1, limit = 10 } = query;

    // =====================================
    // query appeals + moderation
    // =====================================

    const qb = this.moderationAppealRepository
      .createQueryBuilder('appeal')
      .leftJoin(
        ContentModeration,
        'moderation',
        'moderation.id = appeal.moderation_id',
      )
      .select([
        'appeal.id AS appeal_id',
        'appeal.moderation_id AS moderation_id',
        'appeal.user_id AS user_id',
        'appeal.reason AS reason',
        'appeal.status AS status',
        'appeal.reviewed_by AS reviewed_by',
        'appeal.review_note AS review_note',
        'appeal.reviewed_at AS reviewed_at',
        'appeal.created_at AS created_at',

        'moderation.target_id AS target_id',
        'moderation.target_type AS target_type',
        'moderation.max_severity AS max_severity',
        'moderation.confidence AS confidence',
        'moderation.display_message AS display_message',
        'moderation.final_decision AS final_decision',
      ]);

    if (status) {
      qb.andWhere('appeal.status = :status', { status });
    }

    qb.orderBy('appeal.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const rows = await qb.getRawMany();

    // =====================================
    // total count
    // =====================================

    const countQb =
      this.moderationAppealRepository.createQueryBuilder('appeal');

    if (status) {
      countQb.andWhere('appeal.status = :status', { status });
    }

    const total = await countQb.getCount();

    // =====================================
    // collect target ids
    // =====================================

    const postIds: string[] = [];
    const commentIds: string[] = [];
    const shareIds: string[] = [];

    for (const row of rows) {
      if (row.target_type === TargetType.POST) {
        postIds.push(row.target_id);
      }

      if (row.target_type === TargetType.COMMENT) {
        commentIds.push(row.target_id);
      }

      if (row.target_type === TargetType.SHARE) {
        shareIds.push(row.target_id);
      }
    }

    // =====================================
    // batch fetch targets
    // =====================================

    const [posts, comments, shares] = await Promise.all([
      postIds.length
        ? this.postRepository.find({
            where: {
              id: In(postIds),
            },
          })
        : [],

      commentIds.length
        ? this.commentRepository.find({
            where: {
              id: In(commentIds),
            },
          })
        : [],

      shareIds.length
        ? this.shareRepository.find({
            where: {
              id: In(shareIds),
            },
          })
        : [],
    ]);

    // =====================================
    // maps
    // =====================================

    const postMap = new Map<string, Post>(
      posts.map((p): [string, Post] => [p.id, p]),
    );

    const commentMap = new Map<string, Comment>(
      comments.map((c): [string, Comment] => [c.id, c]),
    );

    const shareMap = new Map<string, Share>(
      shares.map((s): [string, Share] => [s.id, s]),
    );

    // =====================================
    // appeal count map
    // =====================================

    const moderationIds = rows.map((r) => r.moderation_id);

    const appealCountsRaw = moderationIds.length
      ? await this.moderationAppealRepository
          .createQueryBuilder('appeal')
          .select('appeal.moderation_id', 'moderationId')
          .addSelect('COUNT(*)', 'count')
          .where('appeal.moderation_id IN (:...moderationIds)', {
            moderationIds,
          })
          .groupBy('appeal.moderation_id')
          .getRawMany()
      : [];

    const appealCountMap = new Map<string, number>(
      appealCountsRaw.map((r): [string, number] => [
        r.moderationId,
        Number(r.count),
      ]),
    );

    // =====================================
    // build response
    // =====================================

    const items: AdminAppealQueueItemDTO[] = rows.map((row) => {
      const targetPreview = ModerationAppealMapper.buildTargetPreview(
        row.target_type,
        row.target_id,
        {
          postMap,
          commentMap,
          shareMap,
        },
      );

      return ModerationAppealMapper.toAdminAppealQueueItemDTO(
        row,
        targetPreview,
        appealCountMap.get(row.moderation_id) ?? 1,
      );
    });

    return new PageResponse(
      plainToInstance(AdminAppealQueueItemDTO, items),
      total,
      page,
      limit,
    );
  }
}
