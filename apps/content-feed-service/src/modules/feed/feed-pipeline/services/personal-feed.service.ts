import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  CursorPageResponse,
  FeedEventType,
  FeedItemDTO,
  PersonalFeedQuery,
  ReactionType,
  TargetType,
} from "@repo/dtos";
import {
  FeedItem,
  FeedItemDocument,
} from "../../mongo/schema/feed-item.schema";
import { SnapshotRepository } from "../../mongo/repository/snapshot.repository";
import { SnapshotMapper } from "src/common/snapshot.mapper";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";

import { PersonalFeedHelper } from "../helpers/personal-feed.helper";
import { AffinityService } from "src/modules/affinity/affinity.service";
import { EmotionFeatureService } from "src/modules/ranking/services/emotion-feature.service";
import { ReactionService } from "../../../post/reaction/reaction.service";
import { MICROSERVICES_CLIENT } from "src/constant";
import { UserClientService } from "../../../post/client/user-client.service";

@Injectable()
export class PersonalFeedService {
  private readonly logger = new Logger(PersonalFeedService.name);

  constructor(
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject(MICROSERVICES_CLIENT.USER_SOCIAL_SERVICE)
    private readonly userSocialClient: ClientProxy,
    private readonly reactionService: ReactionService,
    private readonly affinityService: AffinityService,
    private readonly emotionService: EmotionFeatureService,
    private readonly userClient: UserClientService,
  ) {}

  async getUserFeed(
    userId: string,
    query: PersonalFeedQuery,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    const limit = query.limit ?? 10;
    const cursor = query.cursor ? new Date(query.cursor) : null;
    const fetchMultiplier = query.mainEmotion ? 1 : 2;

    /**
     * LOAD CANDIDATES (windowed)
     */
    const queryCond: any = { userId };

    if (cursor) {
      queryCond.createdAt = { $lt: cursor };
    }

    if (query.mainEmotion) {
      queryCond.emotionLabel = query.mainEmotion.toLowerCase();
    }

    const candidates = await this.feedItemModel
      .find(queryCond)
      .sort({ createdAt: -1 })
      .limit(limit * fetchMultiplier)
      .lean();

    this.logger.debug(`[FEED] candidates=${candidates.length} user=${userId}`);

    if (candidates.length === 0) {
      return new CursorPageResponse([], null, false);
    }

    /**
     * RANK ALL (NO DROP)
     */
    const ranked = await this.rankItems(userId, candidates, query.mainEmotion);

    /**
     * TAKE PAGE
     */
    const page = ranked.slice(0, limit);

    const itemIds = page.map((x) => x.itemId);

    /**
     * LOAD FINAL ITEMS
     */
    const feedItems = await this.feedItemModel
      .find({ _id: { $in: itemIds } })
      .lean();

    const itemMap = new Map(feedItems.map((i) => [i._id.toString(), i]));

    const orderedItems = itemIds
      .map((id) => itemMap.get(id))
      .filter(Boolean) as FeedItem[];

    /**
     * ENRICH
     */
    const { postMapFull, shareMapFull, postReactions, shareReactions } =
      await this.enrichFinalItems(userId, orderedItems);

    const data = this.buildFeedDTO(
      orderedItems,
      postMapFull,
      shareMapFull,
      postReactions,
      shareReactions,
    );

    /**
     * NEXT CURSOR
     */
    const lastCandidate = candidates[candidates.length - 1];

    const nextCursor = lastCandidate?.createdAt
      ? lastCandidate.createdAt.toISOString()
      : null;

    return new CursorPageResponse(
      data,
      nextCursor,
      candidates.length === limit * fetchMultiplier,
    );
  }

  /**
   * SIMPLE RANK (NO HARD FILTER)
   */
  private async rankItems(
    userId: string,
    items: FeedItem[],
    mainEmotion?: string,
  ): Promise<{ itemId: string; score: number }[]> {
    const postMap = await this.loadLightPosts(items, mainEmotion);

    const [emotionFeatures, affinity] = await Promise.all([
      this.emotionService.getEmotionFeatures(userId),
      this.affinityService.getAffinity(userId),
    ]);

    const result: { itemId: string; score: number }[] = [];

    for (const item of items) {
      const itemId = item._id?.toString();
      if (!itemId) continue;

      const recency = PersonalFeedHelper.calcRecency(item.createdAt);

      const post = postMap.get(item.postId);

      /**
       * FALLBACK nếu thiếu post
       */
      if (!post) {
        result.push({
          itemId,
          score: recency * 0.7,
        });
        continue;
      }

      const emotionScore = emotionFeatures
        ? this.emotionService.calcEmotionScore(emotionFeatures, {
            scores: post.emotionFeature?.scores || {},
            confidence: post.emotionFeature?.confidence,
            mentalHealthRiskLevel: post.emotionFeature?.mentalHealthRiskLevel,
          })
        : 0;

      const affinityScore = this.affinityService.calcAffinityScore(affinity, {
        category: post.emotionFeature?.label || "neutral",
        authorId: post.userId,
      });

      const engagement = PersonalFeedHelper.calcEngagement(post.stats);

      const score = PersonalFeedHelper.calcFinalScore({
        recency,
        emotion: emotionScore,
        affinity: affinityScore,
        engagement,
      });

      result.push({
        itemId,
        score,
      });
    }

    /**
     * SORT ONLY (KHÔNG DROP)
     */
    return result.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.itemId.localeCompare(a.itemId);
    });
  }

  private async loadLightPosts(items: FeedItem[], mainEmotion?: string) {
    const postIds = Array.from(new Set(items.map((i) => i.postId)));

    const posts = await this.snapshotRepo.findPostsForRanking(
      postIds,
      mainEmotion ? mainEmotion.toLowerCase() : undefined,
    );

    return new Map(posts.map((p) => [p.postId, p]));
  }

  // ===== giữ nguyên enrich & build DTO của m =====

  /**
   * ENRICH FINAL ITEMS ONLY
   */
  private async enrichFinalItems(userId: string, items: FeedItem[]) {
    const postIdSet = new Set<string>();
    const shareIdSet = new Set<string>();

    for (const item of items) {
      postIdSet.add(item.postId);

      if (item.eventType === FeedEventType.SHARE) {
        shareIdSet.add(item.refId);
      }
    }

    const postIds = Array.from(postIdSet);
    const shareIds = Array.from(shareIdSet);

    const [posts, shares] = await Promise.all([
      postIds.length
        ? this.snapshotRepo.findPostsByIds(postIds)
        : Promise.resolve([]),

      shareIds.length
        ? this.snapshotRepo.findSharesByIds(shareIds)
        : Promise.resolve([]),
    ]);

    const postMap = new Map(posts.map((p) => [p.postId, p]));
    const shareMap = new Map(shares.map((s) => [s.shareId, s]));

    const [postReactions, shareReactions] = await Promise.all([
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

    const groupIds = new Set<string>();
    const userIds = new Set<string>();

    for (const p of posts) {
      if (p.groupId) groupIds.add(p.groupId);
      if (p.userId) userIds.add(p.userId);
    }
    for (const s of shares) {
      if (s.userId) userIds.add(s.userId);
    }

    const groupMap = new Map<string, any>();
    let userMap: Record<string, any> = {};

    const enrichmentPromises: Promise<any>[] = [];

    if (groupIds.size > 0) {
      enrichmentPromises.push(
        firstValueFrom(
          this.userSocialClient.send<any[]>(
            "get_group_info_batch",
            Array.from(groupIds),
          ),
        ).then((groups) => {
          for (const g of groups) {
            groupMap.set(g.id, g);
          }
        }),
      );
    }

    if (userIds.size > 0) {
      enrichmentPromises.push(
        this.userClient.getUserInfos(Array.from(userIds)).then((users) => {
          userMap = users;
        }),
      );
    }

    if (enrichmentPromises.length > 0) {
      await Promise.all(enrichmentPromises);
    }

    for (const post of posts) {
      if (post.groupId) {
        (post as any).group = groupMap.get(post.groupId);
      }
      if (post.userId) {
        (post as any).user = userMap[post.userId];
      }
    }

    for (const share of shares) {
      const post = postMap.get(share.postId);
      if (post?.groupId) {
        (share as any).group = groupMap.get(post.groupId);
      }
      if (share.userId) {
        (share as any).user = userMap[share.userId];
      }
    }

    return {
      postMapFull: postMap,
      shareMapFull: shareMap,
      postReactions,
      shareReactions,
    };
  }

  /**
   * BUILD DTO
   */
  private buildFeedDTO(
    items: FeedItem[],
    postMap: Map<string, any>,
    shareMap: Map<string, any>,
    postReactions: Record<string, ReactionType>,
    shareReactions: Record<string, ReactionType>,
  ): FeedItemDTO[] {
    const result: FeedItemDTO[] = [];

    for (const item of items) {
      const id = item._id?.toString() ?? "";

      const post = postMap.get(item.postId);

      if (!post) {
        this.logger.warn(
          `[FEED] Missing POST postId=${item.postId} itemId=${id}`,
        );

        result.push({
          id,
          type: item.eventType,
          item: {
            id: item.refId,
            status: "missing_post",
          } as any,
        });

        continue;
      }

      // ======================
      // POST
      // ======================
      if (item.eventType === FeedEventType.POST) {
        result.push({
          id,
          type: FeedEventType.POST,
          item: SnapshotMapper.toPostSnapshotDTO(
            post,
            postReactions[item.postId], // dùng postId
          ),
        });

        continue;
      }

      // ======================
      // SHARE
      // ======================
      const share = shareMap.get(item.refId);

      if (!share) {
        this.logger.warn(`[FEED] Missing SHARE snapshot refId=${item.refId}`);

        result.push({
          id,
          type: FeedEventType.SHARE,
          item: {
            id: item.refId,
            status: "missing_share",
          } as any,
        });

        continue;
      }

      result.push({
        id,
        type: FeedEventType.SHARE,
        item: SnapshotMapper.toShareSnapshotDTO(
          share,
          post,
          shareReactions[item.refId],
        ),
      });
    }

    return result;
  }
}
