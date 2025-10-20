import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  PageResponse,
  PaginationDTO,
  ReactionType,
  ShareResponseDTO,
  ShareSnapshotDTO,
  TargetType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { Reaction } from 'src/entities/reaction.entity';
import { Share } from 'src/entities/share.entity';
import { Repository, In } from 'typeorm';
import { ShareCacheService } from './share-cache.service';
import { ShareShortenMapper } from '../share-shorten.mapper';

@Injectable()
export class ShareQueryService {
  constructor(
    @InjectRepository(Share)
    private readonly shareRepo: Repository<Share>,
    @InjectRepository(Reaction)
    private readonly reactionRepo: Repository<Reaction>,
    private readonly shareCache: ShareCacheService
  ) {}

  /** 🔹 Get a single share by id (cached) */
  async findById(
    userRequestId: string,
    shareId: string
  ): Promise<ShareResponseDTO> {
    // Try cache first
    const cached = await this.shareCache.getCachedShare(shareId);
    const share =
      cached ??
      (await this.shareRepo.findOne({
        where: { id: shareId },
        relations: ['post', 'shareStat'],
      }));

    if (!share) throw new RpcException(`Share not found`);
    if (!cached) await this.shareCache.setCachedShare(share);

    // Get user reaction (not cached, low-cost)
    const reaction = await this.reactionRepo.findOne({
      where: {
        userId: userRequestId,
        targetType: TargetType.SHARE,
        targetId: shareId,
      },
      select: ['reactionType'],
    });

    const response = plainToInstance(ShareResponseDTO, share, {
      excludeExtraneousValues: true,
    });

    response.reactedType = reaction?.reactionType ?? undefined;
    return response;
  }

  /** 🔹 Get list of shares by userId (with cache batching) */
  async findByUserId(
    userId: string,
    pagination: PaginationDTO
  ): Promise<PageResponse<ShareSnapshotDTO>> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    // Fetch list of shareIds first (lightweight)
    const ids = await this.shareRepo
      .createQueryBuilder('share')
      .select('share.id')
      .where('share.userId = :userId', { userId })
      .orderBy('share.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    const shareIds = ids.map((s) => s.id);
    if (!shareIds.length) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }

    // Fetch cached shares in batch
    const shares = await this.shareCache.getCachedSharesBatch(
      shareIds,
      this.shareRepo
    );

    // Batch load reactions
    const reactionMap = await this.getReactedTypesBatch(userId, shareIds);

    const data = ShareShortenMapper.toShareSnapshotDTOs(shares, reactionMap);
    const total = await this.shareRepo.count({ where: { userId } });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** 🔹 Batch get multiple shares by ids (cached) */
  async getSharesBatch(ids: string[]): Promise<ShareResponseDTO[]> {
    if (!ids.length) return [];
    const shares = await this.shareCache.getCachedSharesBatch(
      ids,
      this.shareRepo
    );
    return plainToInstance(ShareResponseDTO, shares, {
      excludeExtraneousValues: true,
    });
  }

  /** 🔹 Batch get user's reacted types for multiple shares */
  async getReactedTypesBatch(
    userId: string,
    shareIds: string[]
  ): Promise<Map<string, ReactionType | undefined>> {
    if (!shareIds.length) return new Map();
    const reactions = await this.reactionRepo.find({
      where: { userId, targetType: TargetType.SHARE, targetId: In(shareIds) },
      select: ['targetId', 'reactionType'],
    });
    return new Map(reactions.map((r) => [r.targetId, r.reactionType]));
  }
}
