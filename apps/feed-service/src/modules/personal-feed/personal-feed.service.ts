import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FeedEventType, FeedItemDTO, PaginationDTO } from '@repo/dtos';
import { Model } from 'mongoose';
import { FeedItem, FeedItemDocument } from 'src/mongo/schema/feed-item.schema';
import {
  PostSnapshot,
  PostSnapshotDocument,
} from 'src/mongo/schema/post-snapshot.schema';
import {
  ShareSnapshot,
  ShareSnapshotDocument,
} from 'src/mongo/schema/share-snapshot.schema';
import { PageResponse } from '@repo/dtos';
import { SnapshotMapper } from '../personal-feed/snapshot.mapper';

@Injectable()
export class PersonalFeedService {
  constructor(
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,

    @InjectModel(PostSnapshot.name)
    private readonly postSnapshotModel: Model<PostSnapshotDocument>,

    @InjectModel(ShareSnapshot.name)
    private readonly shareSnapshotModel: Model<ShareSnapshotDocument>,
  ) {}

  /**
   * 📄 Lấy feed của user (trả về FeedItemDTO)
   */
  async getUserFeed(
    userId: string,
    query: PaginationDTO,
  ): Promise<PageResponse<FeedItemDTO>> {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [feedItems, total] = await Promise.all([
      this.feedItemModel
        .find({ userId })
        .sort({ rankingScore: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.feedItemModel.countDocuments({ userId }),
    ]);

    if (!feedItems.length) return new PageResponse([], total, page, limit);

    const postIds = feedItems
      .filter((f) => f.eventType === FeedEventType.POST)
      .map((f) => f.snapshotId);
    const shareIds = feedItems
      .filter((f) => f.eventType === FeedEventType.SHARE)
      .map((f) => f.snapshotId);

    const [posts, shares] = await Promise.all([
      this.postSnapshotModel
        .find({ _id: { $in: postIds } })
        .lean()
        .exec()
        .then((docs) => docs as unknown as PostSnapshot[]),
      this.shareSnapshotModel
        .find({ _id: { $in: shareIds } })
        .lean()
        .exec()
        .then((docs) => docs as unknown as ShareSnapshot[]),
    ]);

    const postMap = new Map(posts.map((p) => [String(p._id), p]));
    const shareMap = new Map(shares.map((s) => [String(s._id), s]));

    const data: FeedItemDTO[] = feedItems.reduce((acc: FeedItemDTO[], item) => {
      if (item.eventType === FeedEventType.POST) {
        const post = postMap.get(item.snapshotId);
        if (post) {
          acc.push({
            id: item._id.toString(),
            type: FeedEventType.POST,
            item: SnapshotMapper.toPostSnapshotDTO(post),
          });
        }
      } else if (item.eventType === FeedEventType.SHARE) {
        const share = shareMap.get(item.snapshotId);
        if (share) {
          acc.push({
            id: item._id.toString(),
            type: FeedEventType.SHARE,
            item: SnapshotMapper.toShareSnapshotDTO(share),
          });
        }
      }
      return acc;
    }, []);

    return new PageResponse(data, total, page, limit);
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

  /**
   * 🧠 Tính điểm ranking tổng hợp
   */
  private calculateRankingScore(
    baseScore: number,
    viewCount = 0,
    createdAt?: Date,
  ): number {
    const now = Date.now();
    const ageHours = createdAt
      ? (now - createdAt.getTime()) / (1000 * 60 * 60)
      : 0;
    const timeDecay = Math.exp(-0.01 * ageHours);
    const viewDecay = Math.pow(0.95, viewCount);
    return baseScore * timeDecay * viewDecay;
  }
}
