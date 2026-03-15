import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { Model } from 'mongoose';
import { FeedItem, FeedItemDocument } from 'src/mongo/schema/feed-item.schema';
import { SnapshotMapper } from '../../../common/snapshot.mapper';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { RankingService } from '../../ranking/services/ranking.service';
import { RankingCandidate } from '../../ranking/interfaces/ranking-strategy.interface';

@Injectable()
export class PersonalFeedService {
  private readonly logger = new Logger(PersonalFeedService.name);

  constructor(
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy,
    @Inject('GROUP_SERVICE') private readonly groupClient: ClientProxy,
    private readonly rankingService: RankingService, // ⭐ Inject RankingService
  ) {}

  /**
   * 📌 Personal feed with emotion-aware ranking
   *
   * New Flow (schema updated):
   * 1. Query feed_items (có postId cho cả POST và SHARE)
   * 2. Extract unique postIds → batch load post_snapshots (1 query)
   * 3. Build RankingCandidates từ post_snapshots
   * 4. Re-rank with RankingService
   * 5. Load share_snapshots CHỈ cho top N SHARE items
   * 6. Map to DTO
   */
  async getUserFeed(
    userId: string,
    query: PersonalFeedQuery,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    const { cursor, limit, mainEmotion } = query;

    // 🎯 Step 1: Over-fetch feed items (3x for re-ranking)
    const overFetchLimit = limit * 3;
    const feedItems = await this.getFeedItems(userId, cursor, overFetchLimit);
    if (!feedItems.length) return new CursorPageResponse([], null, false);

    const hasNextPage = feedItems.length > overFetchLimit;
    const candidates = feedItems.slice(0, overFetchLimit);

    // 🎯 Step 2: Extract unique postIds (feed_items.postId works for both POST & SHARE)
    const uniquePostIds = Array.from(
      new Set(candidates.map((item) => item.postId)),
    );

    // 🎯 Step 3: Batch load post_snapshots (1 query!)
    const posts = await this.snapshotRepo.findPostsByIds(
      uniquePostIds,
      mainEmotion,
    );
    const postMap = new Map(posts.map((p) => [p.postId, p]));

    // 🎯 Step 4: Build RankingCandidates từ post_snapshots
    const rankingCandidates: RankingCandidate[] = [];

    for (const item of candidates) {
      const post = postMap.get(item.postId);
      if (post) {
        rankingCandidates.push({
          postId: item.postId,
          snapshot: post,
          baseScore: item.rankingScore ?? 1000,
          timestamp: new Date(item.createdAt ?? Date.now()),
        });
      }
    }

    if (!rankingCandidates.length) {
      return new CursorPageResponse([], null, false);
    }

    // 🎯 Step 5: Re-rank with emotional state adjustment
    const ranked = await this.rankingService.rankForPersonal(
      rankingCandidates,
      userId,
    );

    const topRanked = ranked.slice(0, limit);

    // 🎯 Step 6: Build response DTOs
    // Map ranked postIds back to original feedItems
    const rankedPostIdSet = new Set(topRanked.map((r) => r.postId));
    const topFeedItems = candidates.filter((item) =>
      rankedPostIdSet.has(item.postId),
    );

    // Load share snapshots for SHARE items only
    const shareIds = topFeedItems
      .filter((item) => item.eventType === FeedEventType.SHARE)
      .map((item) => item.refId);

    const shares = await this.snapshotRepo.findSharesByIds(shareIds);
    const shareMap = new Map(shares.map((s) => [s.shareId, s]));

    // Load group info
    const groupIds = Array.from(
      new Set(posts.map((p) => p.groupId).filter(Boolean) as string[]),
    );

    let groupMap = new Map<string, GroupInfoDTO>();
    if (groupIds.length > 0) {
      const groups = await firstValueFrom(
        this.groupClient.send<GroupInfoDTO[]>('get_group_info_batch', groupIds),
      );
      groupMap = new Map(groups.map((g) => [g.id, g]));
    }

    // Attach groups to posts
    posts.forEach((post) => {
      if (post.groupId) {
        (post as any).group = groupMap.get(post.groupId);
      }
    });

    // Get reactions
    const postIds = topFeedItems
      .filter((item) => item.eventType === FeedEventType.POST)
      .map((item) => item.refId);

    const [postReactions, shareReactions] = await Promise.all([
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
    ]);

    // 🎯 Step 7: Map to FeedItemDTO (preserve ranking order)
    const data: FeedItemDTO[] = [];
    for (const rankedItem of topRanked) {
      const feedItem = topFeedItems.find(
        (item) => item.postId === rankedItem.postId,
      );
      if (!feedItem) continue;

      const post = postMap.get(feedItem.postId);
      if (!post) continue;

      if (feedItem.eventType === FeedEventType.POST) {
        const reactedType = postReactions?.[feedItem.refId];
        data.push({
          id: feedItem._id?.toString() ?? '',
          type: FeedEventType.POST,
          item: SnapshotMapper.toPostSnapshotDTO(post, reactedType),
        });
      } else if (feedItem.eventType === FeedEventType.SHARE) {
        const share = shareMap.get(feedItem.refId);
        const reactedType = shareReactions?.[feedItem.refId];
        if (share) {
          data.push({
            id: feedItem._id?.toString() ?? '',
            type: FeedEventType.SHARE,
            item: SnapshotMapper.toShareSnapshotDTO(share, post, reactedType),
          });
        }
      }
    }

    // 🎯 Step 8: Build cursor
    let nextCursor: string | null = null;
    if (data.length > 0 && topRanked.length > 0) {
      const lastRanked = topRanked[topRanked.length - 1];
      const lastFeedItem = topFeedItems.find(
        (item) => item.postId === lastRanked.postId,
      );
      if (lastFeedItem) {
        nextCursor = `${lastFeedItem.rankingScore}_${new Date(
          lastFeedItem.createdAt ?? Date.now(),
        ).getTime()}`;
      }
    }

    this.logger.log(
      `Personal feed for user ${userId}: ${topRanked.length}/${rankingCandidates.length} items re-ranked`,
    );

    return new CursorPageResponse(data, nextCursor, hasNextPage);
  }

  /**
   * 👁️ Mark feed items as viewed
   * - Reduce rankingScore by 10% (decay mechanism)
   * - Track viewed emotions for affinity learning
   */
  async markFeedItemViewed(userId: string, feedItemIds: string[]) {
    if (!feedItemIds?.length) return;

    // 1️⃣ Update rankingScore decay
    await this.feedItemModel.updateMany({ _id: { $in: feedItemIds } }, [
      {
        $set: {
          rankingScore: { $multiply: ['$rankingScore', 0.9] },
          lastViewedAt: new Date(),
        },
      },
    ]);

    // 2️⃣ Track viewed emotions for affinity learning
    const feedItems = await this.feedItemModel
      .find({ _id: { $in: feedItemIds } })
      .lean();

    if (!feedItems.length) return;

    // Extract unique postIds (feedItem.postId works for both POST & SHARE)
    const postIds = Array.from(new Set(feedItems.map((item) => item.postId)));

    // Batch load posts
    const posts = await this.snapshotRepo.findPostsByIds(postIds);

    // Track each viewed post with emotion
    const trackPromises: Promise<void>[] = [];

    posts.forEach((post) => {
      if (post.emotionFeature?.label) {
        trackPromises.push(
          this.rankingService.trackUserView(
            userId,
            post.postId,
            post.emotionFeature.label,
            post.emotionFeature.scores,
          ),
        );
      }
    });

    if (trackPromises.length > 0) {
      await Promise.all(trackPromises);
      this.logger.debug(
        `Tracked ${trackPromises.length} viewed emotions for user ${userId}`,
      );
    }
  }

  // ========================================================
  // Private helpers
  // ========================================================

  /** 🔹 Truy vấn feed items từ Mongo */
  private async getFeedItems(userId: string, cursor?: string, limit = 10) {
    const filter: any = { userId };
    if (cursor) {
      const [rankingScore, createdAt] = cursor.split('_').map(Number);
      filter.$or = [
        { rankingScore: { $lt: rankingScore } },
        { rankingScore, createdAt: { $lt: new Date(createdAt) } },
      ];
    }

    return this.feedItemModel
      .find(filter)
      .sort({ rankingScore: -1, createdAt: -1 })
      .limit(limit + 1)
      .lean();
  }
}
