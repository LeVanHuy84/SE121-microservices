import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { FeedEventType, FeedItemDTO, TargetType } from "@repo/dtos";
import {
  FeedItem,
  FeedItemDocument,
} from "../../mongo/schema/feed-item.schema";
import { SnapshotRepository } from "../../mongo/repository/snapshot.repository";
import { SnapshotMapper } from "../../common/snapshot.mapper";
import { ReactionService } from "../../../post/reaction/reaction.service";
import { UserClientService } from "../../../post/client/user-client.service";
import { GroupClientService } from "../../../post/client/group-client.service";

@Injectable()
export class FeedHydrationService {
  private readonly logger = new Logger(FeedHydrationService.name);

  constructor(
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,
    private readonly snapshotRepo: SnapshotRepository,
    private readonly reactionService: ReactionService,
    private readonly userClient: UserClientService,
    private readonly groupClient: GroupClientService,
  ) {}

  /**
   * Hydrate a page of posts for Trending Feed
   */
  async hydratePostPage(
    topIds: string[],
    userId?: string,
  ): Promise<FeedItemDTO[]> {
    if (!topIds?.length) return [];

    const posts = await this.snapshotRepo.findPostsByIds(topIds);
    const postMap = new Map(posts.map((p) => [p.postId, p]));

    const orderedPosts = topIds
      .map((id) => postMap.get(id))
      .filter((p): p is any => !!p);

    const groupIds = Array.from(
      new Set(orderedPosts.map((p) => p.groupId).filter(Boolean)),
    );
    const userIds = Array.from(
      new Set(orderedPosts.map((p) => p.userId).filter(Boolean)),
    );

    const [reactions, groups, users] = await Promise.all([
      userId
        ? this.reactionService.getReactedTypesBatch(
            userId,
            TargetType.POST,
            orderedPosts.map((p) => p.postId),
          )
        : Promise.resolve({}),
      this.groupClient.getGroupInfos(groupIds),
      this.userClient.getUserInfos(userIds),
    ]);

    return orderedPosts.map((post) => ({
      id: post.postId,
      type: FeedEventType.POST,
      item: SnapshotMapper.toPostSnapshotDTO(
        post,
        reactions[post.postId],
        post.userId ? users[post.userId] : undefined,
        post.groupId ? groups.get(post.groupId) : undefined,
      ),
    }));
  }

  /**
   * Hydrate a page of feed items for Personal Feed
   * Optionally accepts preloadedFeedItems (e.g., from initial candidate pool) to avoid redundant MongoDB queries.
   */
  async hydrateFeedItemPage(
    userId: string,
    itemIds: string[],
    preloadedFeedItems?: FeedItem[],
  ): Promise<FeedItemDTO[]> {
    if (!itemIds?.length) return [];

    let feedItems: FeedItem[];

    if (preloadedFeedItems && preloadedFeedItems.length > 0) {
      const preloadedMap = new Map(
        preloadedFeedItems.map((i) => [i._id?.toString() || "", i]),
      );
      const matched = itemIds
        .map((id) => preloadedMap.get(id))
        .filter(Boolean) as FeedItem[];

      // If all itemIds are in preloaded array, use them directly
      if (matched.length === itemIds.length) {
        feedItems = matched;
      } else {
        feedItems = await this.feedItemModel
          .find({ _id: { $in: itemIds } })
          .lean();
      }
    } else {
      feedItems = await this.feedItemModel
        .find({ _id: { $in: itemIds } })
        .lean();
    }

    const itemMap = new Map(feedItems.map((i) => [i._id?.toString() || "", i]));
    const orderedItems = itemIds
      .map((id) => itemMap.get(id))
      .filter(Boolean) as FeedItem[];

    const postIdSet = new Set<string>();
    const shareIdSet = new Set<string>();

    for (const item of orderedItems) {
      if (item.postId) {
        postIdSet.add(item.postId);
      }
      if (item.eventType === FeedEventType.SHARE && item.refId) {
        shareIdSet.add(item.refId);
      }
    }

    const postIds = Array.from(postIdSet);
    const shareIds = Array.from(shareIdSet);

    const [posts, shares, postReactions, shareReactions] = await Promise.all([
      postIds.length
        ? this.snapshotRepo.findPostsByIds(postIds)
        : Promise.resolve([]),
      shareIds.length
        ? this.snapshotRepo.findSharesByIds(shareIds)
        : Promise.resolve([]),
      postIds.length
        ? this.reactionService.getReactedTypesBatch(
            userId,
            TargetType.POST,
            postIds,
          )
        : Promise.resolve({}),
      shareIds.length
        ? this.reactionService.getReactedTypesBatch(
            userId,
            TargetType.SHARE,
            shareIds,
          )
        : Promise.resolve({}),
    ]);

    const postMap = new Map(posts.map((p) => [p.postId, p]));
    const shareMap = new Map(shares.map((s) => [s.shareId, s]));

    const groupIds = new Set<string>();
    const userIds = new Set<string>();

    for (const p of posts) {
      if (p.groupId) groupIds.add(p.groupId);
      if (p.userId) userIds.add(p.userId);
    }
    for (const s of shares) {
      if (s.userId) userIds.add(s.userId);
    }

    const [groupMap, userMap] = await Promise.all([
      this.groupClient.getGroupInfos(Array.from(groupIds)),
      this.userClient.getUserInfos(Array.from(userIds)),
    ]);

    const result: FeedItemDTO[] = [];

    for (const item of orderedItems) {
      const id = item._id?.toString() ?? "";
      const post = postMap.get(item.postId);

      if (!post) {
        this.logger.warn(
          `[FEED] Missing POST snapshot postId=${item.postId} itemId=${id}. Removing orphan feed item.`,
        );
        if (item._id) {
          this.feedItemModel
            .deleteOne({ _id: item._id })
            .catch((err) =>
              this.logger.error(
                `[FEED] Failed to clean up orphan feed item ${id}: ${err?.message}`,
              ),
            );
        }
        continue;
      }

      if (item.eventType === FeedEventType.POST) {
        result.push({
          id,
          type: FeedEventType.POST,
          item: SnapshotMapper.toPostSnapshotDTO(
            post,
            postReactions[item.postId],
            post.userId ? userMap[post.userId] : undefined,
            post.groupId ? groupMap.get(post.groupId) : undefined,
          ),
        });
        continue;
      }

      const share = shareMap.get(item.refId);
      if (!share) {
        this.logger.warn(
          `[FEED] Missing SHARE snapshot refId=${item.refId} itemId=${id}. Removing orphan feed item.`,
        );
        if (item._id) {
          this.feedItemModel
            .deleteOne({ _id: item._id })
            .catch((err) =>
              this.logger.error(
                `[FEED] Failed to clean up orphan feed item ${id}: ${err?.message}`,
              ),
            );
        }
        continue;
      }

      result.push({
        id,
        type: FeedEventType.SHARE,
        item: SnapshotMapper.toShareSnapshotDTO(
          share,
          post,
          shareReactions[item.refId],
          share.userId ? userMap[share.userId] : undefined,
          post.userId ? userMap[post.userId] : undefined,
          post.groupId ? groupMap.get(post.groupId) : undefined,
        ),
      });
    }

    return result;
  }
}
