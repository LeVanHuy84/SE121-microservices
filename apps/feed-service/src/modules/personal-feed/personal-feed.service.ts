import { Injectable } from '@nestjs/common';
import {
  CursorPageResponse,
  FeedEventType,
  FeedItemDTO,
  PersonalFeedQuery,
} from '@repo/dtos';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FeedItem, FeedItemDocument } from 'src/mongo/schema/feed-item.schema';
import { SnapshotMapper } from '../../common/snapshot.mapper';
import { CacheLayerService } from '../cache-layer/cache-layer.service';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';

@Injectable()
export class PersonalFeedService {
  constructor(
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,
    private readonly snapshotCache: CacheLayerService,
    private readonly snapshotRepo: SnapshotRepository,
  ) {}

  // ========================================================
  // Public API
  // ========================================================

  async getUserFeed(
    userId: string,
    query: PersonalFeedQuery,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    const { cursor, limit, mainEmotion } = query;

    const feedItems = await this.getFeedItems(userId, cursor, limit);
    console.log('feedItems: ', feedItems);
    if (!feedItems.length)
      return new CursorPageResponse([], limit, null, false);

    const hasNextPage = feedItems.length > limit;
    const items = feedItems.slice(0, limit);

    const { postMap, shareMap } = await this.resolveSnapshots(
      items,
      mainEmotion,
    );

    console.log('postMap: ', postMap.entries());

    const data = this.buildFeedDTO(items, postMap, shareMap);

    console.log('data: ', data);

    const last = items[items.length - 1];
    const nextCursor = `${last.rankingScore}_${new Date(
      last.createdAt ?? Date.now(),
    ).getTime()}`;

    return new CursorPageResponse(data, limit, nextCursor, hasNextPage);
  }

  /**
   * 👁️ Khi user xem batch feed item, giảm rankingScore 5%
   */
  async markFeedItemViewed(feedItemIds: string[]) {
    if (!feedItemIds?.length) return;

    await this.feedItemModel.updateMany({ _id: { $in: feedItemIds } }, [
      {
        $set: {
          rankingScore: { $multiply: ['$rankingScore', 0.95] },
          lastViewedAt: new Date(),
        },
      },
    ]);
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

  /** 🔹 Resolve snapshot từ cache + DB fallback */
  private async resolveSnapshots(
    items: FeedItem[],
    mainEmotion?: string,
  ): Promise<{
    postMap: Map<string, PostSnapshot>;
    shareMap: Map<string, ShareSnapshot>;
  }> {
    const postIds = items
      .filter((f) => f.eventType === FeedEventType.POST)
      .map((f) => f.refId);
    const shareIds = items
      .filter((f) => f.eventType === FeedEventType.SHARE)
      .map((f) => f.refId);

    // Cache layer
    const [postCache, shareCache] = await Promise.all([
      this.snapshotCache.getPostBatch(postIds),
      this.snapshotCache.getShareBatch(shareIds),
    ]);

    const missingPostIds = postIds.filter((id) => !postCache.has(id));
    const missingShareIds = shareIds.filter((id) => !shareCache.has(id));

    // Fallback DB
    const [postDB, shareDB] = await Promise.all([
      this.snapshotRepo.findPostsByIds(missingPostIds, mainEmotion),
      this.snapshotRepo.findSharesByIds(missingShareIds, mainEmotion),
    ]);

    // Cache new
    await Promise.all([
      this.snapshotCache.setPostBatch(postDB),
      this.snapshotCache.setShareBatch(shareDB),
    ]);

    // Merge
    const postMap = new Map<string, PostSnapshot>([
      ...postCache.entries(),
      ...postDB.map((p) => [p.postId, p] as [string, PostSnapshot]),
    ]);
    const shareMap = new Map<string, ShareSnapshot>([
      ...shareCache.entries(),
      ...shareDB.map((s) => [s.shareId, s] as [string, ShareSnapshot]),
    ]);

    return { postMap, shareMap };
  }

  /** 🔹 Build danh sách DTO từ snapshot map */
  private buildFeedDTO(
    items: FeedItem[],
    postMap: Map<string, PostSnapshot>,
    shareMap: Map<string, ShareSnapshot>,
  ): FeedItemDTO[] {
    return items.reduce((acc: FeedItemDTO[], item) => {
      if (item.eventType === FeedEventType.POST) {
        const post = postMap.get(item.refId);
        if (post) {
          acc.push({
            id: item._id?.toString() ?? '',
            type: FeedEventType.POST,
            item: SnapshotMapper.toPostSnapshotDTO(post),
          });
        }
      } else if (item.eventType === FeedEventType.SHARE) {
        const share = shareMap.get(item.refId);
        if (share) {
          acc.push({
            id: item._id?.toString() ?? '',
            type: FeedEventType.SHARE,
            item: SnapshotMapper.toShareSnapshotDTO(share),
          });
        }
      }
      return acc;
    }, []);
  }
}
