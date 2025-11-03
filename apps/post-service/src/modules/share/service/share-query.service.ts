import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Audience,
  CursorPageResponse,
  CursorPaginationDTO,
  ReactionType,
  SharePreviewDTO,
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
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ShareQueryService {
  constructor(
    @Inject('SOCIAL_SERVICE') private readonly socialClient: ClientProxy,
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
    const post = await this.shareCache.getShare(shareId);
    if (!post) throw new RpcException(`Share not found`);

    // Get user reaction (not cached, low-cost)
    const [_, userReaction] = await Promise.all([
      this.ensureCanView(userRequestId, post.userId, post.audience),
      this.reactionRepo.findOne({
        where: {
          userId: userRequestId,
          targetType: TargetType.SHARE,
          targetId: shareId,
        },
        select: ['reactionType'],
      }),
    ]);

    const response = plainToInstance(ShareResponseDTO, post, {
      excludeExtraneousValues: true,
    });

    response.reactedType = userReaction?.reactionType;
    return response;
  }

  // ----------------------------------------
  // 🧍‍♂️ 1️⃣ Bài viết của chính mình
  // ----------------------------------------
  async getMyPosts(
    currentUserId: string,
    query: CursorPaginationDTO
  ): Promise<CursorPageResponse<ShareSnapshotDTO>> {
    const qb = this.buildShareQuery(query).where('s.userId = :userId', {
      userId: currentUserId,
    });

    const ids = await qb.select('s.id').getMany();
    const hasNextPage = ids.length > query.limit;
    if (hasNextPage) ids.pop(); // bỏ bản ghi dư ra
    const shareIds = ids.map((s) => s.id);

    const shares = await this.shareCache.getSharesBatch(shareIds);
    if (!shares.length) return new CursorPageResponse([], null, false);

    return this.buildPagedShareResponse(currentUserId, shares, hasNextPage);
  }

  // ----------------------------------------
  // 🌍 2️⃣ Bài viết của người khác (tuỳ quan hệ)
  // ----------------------------------------
  async getUserShares(
    userId: string,
    currentUserId: string,
    query: CursorPaginationDTO
  ): Promise<CursorPageResponse<ShareSnapshotDTO>> {
    const relation = await this.shareCache.getRelationship(
      currentUserId,
      userId,
      async () => {
        return await firstValueFrom(
          this.socialClient.send('get_relationship_status', {
            userId: currentUserId,
            targetId: userId,
          })
        );
      }
    );

    const qb = this.buildShareQuery(query).where('s.userId = :userId', {
      userId,
    });

    if (userId === currentUserId) {
      // chính mình → xem hết
    } else if (['BLOCKED', 'BLOCKED_BY'].includes(relation)) {
      return new CursorPageResponse([], null, false);
    } else if (relation === 'FRIENDS') {
      qb.andWhere('s.audience IN (:...audiences)', {
        audiences: [Audience.PUBLIC, Audience.FRIENDS],
      });
    } else {
      qb.andWhere('s.audience = :audience', { audience: Audience.PUBLIC });
    }

    const ids = await qb.select('s.id').getMany();
    const hasNextPage = ids.length > query.limit;
    if (hasNextPage) ids.pop(); // bỏ bản ghi dư ra
    const shareIds = ids.map((s) => s.id);

    const shares = await this.shareCache.getSharesBatch(shareIds);
    if (!shares.length) return new CursorPageResponse([], null, false);

    return this.buildPagedShareResponse(currentUserId, shares, hasNextPage);
  }

  // ----------------------------------------
  // 🌍 2️⃣ Get share theo postId
  // ----------------------------------------
  async findSharesByPostId(
    postId: string,
    query: CursorPaginationDTO
  ): Promise<CursorPageResponse<SharePreviewDTO>> {
    const qb = this.buildShareQuery(query)
      .where('s.postId = :postId', { postId })
      .andWhere('s.audience = :audience', { audience: Audience.PUBLIC })
      .select(['s.id', 's.userId', 's.audience', 's.content', 's.createdAt']);

    const shares = await qb.getMany();
    const hasNextPage = shares.length > query.limit;
    if (hasNextPage) shares.pop();

    const previews: SharePreviewDTO[] = shares.map((s) => ({
      shareId: s.id,
      userId: s.userId,
      audience: s.audience,
      content: s.content,
      createdAt: s.createdAt,
    }));

    const nextCursor = hasNextPage
      ? shares[shares.length - 1].createdAt.toISOString()
      : null;

    return new CursorPageResponse(previews, nextCursor, hasNextPage);
  }

  // ----------------------------------------
  // ⚙️ Helpers chung
  // ----------------------------------------
  private buildShareQuery(query: CursorPaginationDTO) {
    const { cursor, limit } = query;
    const qb = this.shareRepo
      .createQueryBuilder('s')
      .orderBy('s.createdAt', 'DESC')
      .take(limit + 1); // lấy dư 1 record để xác định hasNextPage

    if (cursor) {
      qb.andWhere('s.createdAt < :cursor', { cursor });
    }
    return qb;
  }

  private async buildPagedShareResponse(
    currentUserId: string,
    shares: Share[],
    hasNextPage: boolean
  ): Promise<CursorPageResponse<ShareSnapshotDTO>> {
    const shareIds = shares.map((s) => s.id);
    const reactionMap = await this.getReactedTypesBatch(
      currentUserId,
      shareIds
    );

    const shareDTOs = ShareShortenMapper.toShareSnapshotDTOs(
      shares,
      reactionMap
    );
    let nextCursor: string | null = null;
    if (hasNextPage && shares.length > 0) {
      nextCursor = shares[shares.length - 1].createdAt.toISOString();
    }

    return new CursorPageResponse(shareDTOs, nextCursor, hasNextPage);
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

  private async ensureCanView(
    userId: string,
    shareUserId: string,
    audience: Audience
  ): Promise<void> {
    if (shareUserId === userId) return;

    const relation = await this.shareCache.getRelationship(
      userId,
      shareUserId,
      async () => {
        return await firstValueFrom(
          this.socialClient.send('get_relationship_status', {
            userId,
            targetId: shareUserId,
          })
        );
      }
    );

    if (['BLOCKED', 'BLOCKED_BY'].includes(relation))
      throw new RpcException('Forbidden: You are blocked');

    if (audience === Audience.ONLY_ME)
      throw new RpcException('Forbidden: Private post');

    if (audience === Audience.FRIENDS && relation !== 'FRIENDS')
      throw new RpcException('Forbidden: Friends only');
  }
}
