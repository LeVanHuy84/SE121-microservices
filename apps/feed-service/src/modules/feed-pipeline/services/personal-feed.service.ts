import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  CursorPageResponse,
  FeedEventType,
  FeedItemDTO,
  GroupInfoDTO,
  PersonalFeedQuery,
  ReactionType,
  TargetType,
} from '@repo/dtos';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FeedItem, FeedItemDocument } from 'src/mongo/schema/feed-item.schema';
import { SnapshotMapper } from '../../../common/snapshot.mapper';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { RankingService } from '../../ranking/services/ranking.service';
import { RankingCandidate } from '../../ranking/interfaces/ranking-strategy.interface';
import Redis from 'ioredis';

type PersonalRankingCandidate = RankingCandidate & {
  candidateId: string;
};

type PersonalFeedCursor = {
  offset: number;
  frontier: {
    score: number;
    createdAt: number;
    id: string;
  } | null;
};

@Injectable()
export class PersonalFeedService {
  private readonly logger = new Logger(PersonalFeedService.name);
  private readonly sessionWindowTtlSeconds = 300;
  private readonly maxSessionWindowSize = 300;

  constructor(
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy,
    @Inject('GROUP_SERVICE') private readonly groupClient: ClientProxy,
    @InjectRedis() private readonly redis: Redis,
    private readonly rankingService: RankingService,
  ) {}

  async getUserFeed(
    userId: string,
    query: PersonalFeedQuery,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    if (query.mainEmotion) {
      return this.getEmotionFilteredFeed(userId, query);
    }

    return this.getRankedFeed(userId, query);
  }

  private async getEmotionFilteredFeed(
    userId: string,
    query: PersonalFeedQuery,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    const { limit, mainEmotion } = query;
    const pageLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;

    const feedItems = await this.feedItemModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(pageLimit)
      .lean();

    if (!feedItems.length) {
      return new CursorPageResponse([], null, false);
    }

    const postIds = [...new Set(feedItems.map((f) => f.postId))];

    const posts = await this.snapshotRepo.findPostsByIds(postIds, mainEmotion);
    const postMap = new Map(posts.map((p) => [p.postId, p]));

    const shareIds = feedItems
      .filter((f) => f.eventType === FeedEventType.SHARE)
      .map((f) => f.refId);

    const shares = await this.snapshotRepo.findSharesByIds(shareIds);
    const shareMap = new Map(shares.map((s) => [s.shareId, s]));

    const data: FeedItemDTO[] = [];

    for (const feedItem of feedItems) {
      const post = postMap.get(feedItem.postId);
      if (!post) continue;

      if (feedItem.eventType === FeedEventType.POST) {
        data.push({
          id: feedItem._id?.toString() ?? '',
          type: FeedEventType.POST,
          item: SnapshotMapper.toPostSnapshotDTO(post),
        });
      } else {
        const share = shareMap.get(feedItem.refId);
        if (!share) continue;

        data.push({
          id: feedItem._id?.toString() ?? '',
          type: FeedEventType.SHARE,
          item: SnapshotMapper.toShareSnapshotDTO(share, post),
        });
      }
    }

    const lastItem = feedItems[feedItems.length - 1];

    const nextCursor = lastItem
      ? `${lastItem.createdAt?.getTime()}:${lastItem._id}`
      : null;

    return new CursorPageResponse(
      data,
      nextCursor,
      feedItems.length === pageLimit,
    );
  }

  /**
   * =====================================================
   * PERSONAL RANKED FEED
   * =====================================================
   */

  private async getRankedFeed(
    userId: string,
    query: PersonalFeedQuery,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    const { cursor, limit } = query;
    const pageLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;

    const parsedCursor = this.parseCursor(cursor);
    const sessionKey = this.getSessionWindowKey(userId);

    let offset = parsedCursor.offset;
    let windowIds = await this.getSessionWindow(sessionKey);

    /**
     * rebuild window nếu cache miss
     */
    if (!windowIds) {
      const rebuiltWindow = await this.buildRankedWindow(
        userId,
        undefined,
        parsedCursor.frontier,
      );

      windowIds = rebuiltWindow;
      offset = 0;

      if (windowIds.length) {
        await this.redis.setex(
          sessionKey,
          this.sessionWindowTtlSeconds,
          windowIds.join(','),
        );
      }
    }

    if (!windowIds?.length || offset >= windowIds.length) {
      return new CursorPageResponse([], null, false);
    }

    const pageIds = windowIds.slice(offset, offset + pageLimit);

    const topFeedItems = await this.findFeedItemsByIdsInOrder(pageIds);

    if (!topFeedItems.length) {
      return new CursorPageResponse([], null, false);
    }

    /**
     * ==============================
     * Load snapshots + reactions (parallel)
     * ==============================
     */

    const uniquePostIds = Array.from(
      new Set(topFeedItems.map((i) => i.postId)),
    );

    const shareIds = topFeedItems
      .filter((i) => i.eventType === FeedEventType.SHARE)
      .map((i) => i.refId);

    const postIds = topFeedItems
      .filter((i) => i.eventType === FeedEventType.POST)
      .map((i) => i.refId);

    const [posts, shares, [postReactions, shareReactions]] = await Promise.all([
      this.snapshotRepo.findPostsByIds(uniquePostIds),

      this.snapshotRepo.findSharesByIds(shareIds),

      Promise.all([
        firstValueFrom(
          this.postClient.send<Record<string, ReactionType>>(
            'get_reacted_types_batch',
            {
              userId,
              targetType: TargetType.POST,
              targetIds: postIds,
            },
          ),
        ),
        firstValueFrom(
          this.postClient.send<Record<string, ReactionType>>(
            'get_reacted_types_batch',
            {
              userId,
              targetType: TargetType.SHARE,
              targetIds: shareIds,
            },
          ),
        ),
      ]),
    ]);

    const postMap = new Map(posts.map((p) => [p.postId, p]));
    const shareMap = new Map(shares.map((s) => [s.shareId, s]));

    /**
     * ==============================
     * Load group info
     * ==============================
     */

    const groupIds = Array.from(
      new Set(posts.map((p) => p.groupId).filter(Boolean) as string[]),
    );

    let groupMap = new Map<string, GroupInfoDTO>();

    if (groupIds.length) {
      const groups = await firstValueFrom(
        this.groupClient.send<GroupInfoDTO[]>('get_group_info_batch', groupIds),
      );

      groupMap = new Map(groups.map((g) => [g.id, g]));
    }

    posts.forEach((post) => {
      if (post.groupId) {
        (post as any).group = groupMap.get(post.groupId);
      }
    });

    /**
     * ==============================
     * Map DTO
     * ==============================
     */

    const data: FeedItemDTO[] = [];

    for (const feedItem of topFeedItems) {
      const post = postMap.get(feedItem.postId);
      if (!post) continue;

      if (feedItem.eventType === FeedEventType.POST) {
        const reactedType = postReactions?.[feedItem.refId];

        data.push({
          id: feedItem._id?.toString() ?? '',
          type: FeedEventType.POST,
          item: SnapshotMapper.toPostSnapshotDTO(post, reactedType),
        });
      } else {
        const share = shareMap.get(feedItem.refId);
        if (!share) continue;

        const reactedType = shareReactions?.[feedItem.refId];

        data.push({
          id: feedItem._id?.toString() ?? '',
          type: FeedEventType.SHARE,
          item: SnapshotMapper.toShareSnapshotDTO(share, post, reactedType),
        });
      }
    }

    /**
     * ==============================
     * Cursor build (NO extra query)
     * ==============================
     */

    let nextCursor: string | null = null;
    const nextOffset = offset + pageIds.length;
    const hasNextPage = nextOffset < windowIds.length;

    if (hasNextPage) {
      const lastItem = topFeedItems[topFeedItems.length - 1];

      if (lastItem?._id) {
        nextCursor = `${nextOffset}:${lastItem.rankingScore ?? 0}:${new Date(
          lastItem.createdAt ?? Date.now(),
        ).getTime()}:${lastItem._id.toString()}`;
      }
    }

    this.logger.log(
      `Personal ranked feed for user ${userId}: ${data.length}/${windowIds.length}`,
    );

    return new CursorPageResponse(data, nextCursor, hasNextPage);
  }

  /**
   * =====================================================
   * SESSION WINDOW
   * =====================================================
   */

  private async buildRankedWindow(
    userId: string,
    mainEmotion?: string,
    frontier?: PersonalFeedCursor['frontier'] | null,
  ): Promise<string[]> {
    const candidateLimit = this.maxSessionWindowSize * 2;

    const candidates = await this.getCandidatesByFrontier(
      userId,
      candidateLimit,
      frontier,
    );

    if (!candidates.length) return [];

    const uniquePostIds = Array.from(new Set(candidates.map((c) => c.postId)));

    const posts = await this.snapshotRepo.findPostsByIds(
      uniquePostIds,
      mainEmotion,
    );

    const postMap = new Map(posts.map((p) => [p.postId, p]));

    const rankingCandidates: PersonalRankingCandidate[] = [];

    for (const item of candidates) {
      const post = postMap.get(item.postId);
      const candidateId = item._id?.toString();

      if (!post || !candidateId) continue;

      rankingCandidates.push({
        candidateId,
        postId: item.postId,
        snapshot: post,
        baseScore: item.rankingScore ?? 1000,
        timestamp: new Date(item.createdAt ?? Date.now()),
      });
    }

    if (!rankingCandidates.length) return [];

    /**
     * skip ranking nếu candidate nhỏ
     */
    if (rankingCandidates.length <= this.maxSessionWindowSize) {
      return rankingCandidates.map((c) => c.candidateId);
    }

    const ranked = await this.rankingService.rankForPersonal(
      rankingCandidates,
      userId,
    );

    return ranked.slice(0, this.maxSessionWindowSize).map((c) => c.candidateId);
  }

  /**
   * =====================================================
   * Mongo helpers
   * =====================================================
   */

  private async getCandidatesByFrontier(
    userId: string,
    limit: number,
    frontier?: PersonalFeedCursor['frontier'] | null,
  ) {
    const filter: any = { userId };

    if (frontier && Types.ObjectId.isValid(frontier.id)) {
      const cursorId = new Types.ObjectId(frontier.id);
      const createdAtDate = new Date(frontier.createdAt);

      filter.$or = [
        { rankingScore: { $lt: frontier.score } },
        { rankingScore: frontier.score, createdAt: { $lt: createdAtDate } },
        {
          rankingScore: frontier.score,
          createdAt: createdAtDate,
          _id: { $lt: cursorId },
        },
      ];
    }

    return this.feedItemModel
      .find(filter)
      .select('_id postId rankingScore createdAt refId eventType')
      .sort({ rankingScore: -1, createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
  }

  private async findFeedItemsByIdsInOrder(candidateIds: string[]) {
    if (!candidateIds.length) return [];

    const objectIds = candidateIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const items = await this.feedItemModel
      .find({ _id: { $in: objectIds } })
      .lean();

    const itemMap = new Map(items.map((i) => [i._id?.toString(), i]));

    return candidateIds
      .map((id) => itemMap.get(id))
      .filter((i): i is (typeof items)[number] => i != null);
  }

  /**
   * =====================================================
   * Redis helpers
   * =====================================================
   */

  private getSessionWindowKey(userId: string) {
    return `feed:session:${userId}:personal`;
  }

  private async getSessionWindow(sessionKey: string): Promise<string[] | null> {
    const cached = await this.redis.get(sessionKey);

    if (!cached) return null;

    return cached.split(',').filter(Boolean);
  }

  /**
   * =====================================================
   * Cursor
   * =====================================================
   */

  private parseCursor(cursor?: string): PersonalFeedCursor {
    if (!cursor) return { offset: 0, frontier: null };

    const parts = cursor.split(':');

    if (parts.length >= 4) {
      const offset = Number(parts[0]);
      const score = Number(parts[1]);
      const createdAt = Number(parts[2]);
      const id = parts.slice(3).join(':');

      return {
        offset: Number.isInteger(offset) ? offset : 0,
        frontier:
          Number.isFinite(score) &&
          Number.isFinite(createdAt) &&
          Types.ObjectId.isValid(id)
            ? { score, createdAt, id }
            : null,
      };
    }

    return { offset: 0, frontier: null };
  }
}
