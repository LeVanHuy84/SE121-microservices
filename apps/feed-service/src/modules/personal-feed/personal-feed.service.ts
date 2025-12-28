import { Inject, Injectable } from '@nestjs/common';
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
import { SnapshotMapper } from '../../common/snapshot.mapper';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class PersonalFeedService {
  constructor(
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy,
    @Inject('GROUP_SERVICE') private readonly groupClient: ClientProxy,
  ) {}

  async getUserFeed(
    userId: string,
    query: PersonalFeedQuery,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    const { cursor, limit, mainEmotion } = query;

    const feedItems = await this.getFeedItems(userId, cursor, limit);
    if (!feedItems.length) return new CursorPageResponse([], null, false);

    const hasNextPage = feedItems.length > limit;
    const items = feedItems.slice(0, limit);

    const { postMap, shareMap } = await this.resolveSnapshots(
      items,
      mainEmotion,
    );

    const postIds = [...postMap.keys()];
    const shareIds = [...shareMap.keys()];

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

    const data = this.buildFeedDTO(
      items,
      postMap,
      shareMap,
      postReactions,
      shareReactions,
    );

    const last = items[items.length - 1];
    const nextCursor = `${last.rankingScore}_${new Date(
      last.createdAt ?? Date.now(),
    ).getTime()}`;

    return new CursorPageResponse(data, nextCursor, hasNextPage);
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

    // 1️⃣ load snapshot từ DB
    const [postDB, shareDB] = await Promise.all([
      this.snapshotRepo.findPostsByIds(postIds, mainEmotion),
      this.snapshotRepo.findSharesByIds(shareIds, mainEmotion),
    ]);

    // 2️⃣ gom tất cả groupId (post + share.post)
    const groupIds = Array.from(
      new Set(
        [
          ...postDB.map((p) => p.groupId),
          ...shareDB.map((s) => s.post?.groupId),
        ].filter(Boolean),
      ),
    ) as string[];

    // 3️⃣ gọi group service batch (trả về array)
    let groupMap = new Map<string, GroupInfoDTO>();

    if (groupIds.length > 0) {
      const groups = await firstValueFrom(
        this.groupClient.send<GroupInfoDTO[]>('get_group_info_batch', groupIds),
      );

      groupMap = new Map(groups.map((g) => [g.id, g]));
    }

    // 4️⃣ attach group vào post snapshot
    postDB.forEach((post) => {
      if (post.groupId) {
        (post as any).group = groupMap.get(post.groupId);
      }
    });

    // 5️⃣ attach group vào share.post snapshot
    shareDB.forEach((share) => {
      const groupId = share.post?.groupId;
      if (groupId) {
        (share.post as any).group = groupMap.get(groupId);
      }
    });

    // 6️⃣ build map trả về
    const postMap = new Map<string, PostSnapshot>(
      postDB.map((p) => [p.postId, p]),
    );

    const shareMap = new Map<string, ShareSnapshot>(
      shareDB.map((s) => [s.shareId, s]),
    );

    return { postMap, shareMap };
  }

  /** 🔹 Build danh sách DTO từ snapshot map */
  private buildFeedDTO(
    items: FeedItem[],
    postMap: Map<string, PostSnapshot>,
    shareMap: Map<string, ShareSnapshot>,
    postReactions?: Record<string, ReactionType>,
    shareReactions?: Record<string, ReactionType>,
  ): FeedItemDTO[] {
    return items.reduce((acc: FeedItemDTO[], item) => {
      if (item.eventType === FeedEventType.POST) {
        const post = postMap.get(item.refId);
        const reactedType = postReactions?.[item.refId]; // 👈 thay .get() bằng []
        if (post) {
          acc.push({
            id: item._id?.toString() ?? '',
            type: FeedEventType.POST,
            item: SnapshotMapper.toPostSnapshotDTO(post, reactedType),
          });
        }
      } else if (item.eventType === FeedEventType.SHARE) {
        const share = shareMap.get(item.refId);
        const reactedType = shareReactions?.[item.refId]; // 👈 tương tự
        if (share) {
          acc.push({
            id: item._id?.toString() ?? '',
            type: FeedEventType.SHARE,
            item: SnapshotMapper.toShareSnapshotDTO(share, reactedType),
          });
        }
      }
      return acc;
    }, []);
  }
}
