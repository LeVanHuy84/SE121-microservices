import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { Model } from "mongoose";
import { randomUUID } from "crypto";
import {
  CursorPageResponse,
  FeedEventType,
  FeedItemDTO,
  PersonalFeedQuery,
  ReactionType,
  RiskHintLevel,
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
  private readonly SESSION_TTL = 1200; // 20 minutes TTL for ranking session
  private readonly CANDIDATE_POOL_SIZE = 100;

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
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async getUserFeed(
    userId: string,
    query: PersonalFeedQuery,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    const limit = query.limit ?? 10;
    const sessionData = PersonalFeedHelper.decodeSessionCursor(query.cursor);

    // ========================================================
    // 🔁 CASE A: SUBSEQUENT PAGE FROM REDIS SESSION SNAPSHOT
    // ========================================================
    if (sessionData) {
      const sessionKey = this.getSessionKey(
        userId,
        query.mainEmotion,
        sessionData.sessionId,
      );
      const metaKey = this.getSessionMetaKey(
        userId,
        query.mainEmotion,
        sessionData.sessionId,
      );
      let totalSessionLength = await this.redis.llen(sessionKey);
      const meta = await this.redis.hgetall(metaKey);
      let isExhausted = meta?.exhausted === "true";

      // 🛡️ Deep Archive Extension: When current active session is nearing exhaustion,
      // seamlessly load older historical candidates from MongoDB feedItemModel
      if (
        sessionData.offset + limit > totalSessionLength &&
        meta &&
        meta.oldestCreatedAt &&
        !isExhausted
      ) {
        const oldestTime = new Date(parseInt(meta.oldestCreatedAt, 10));
        const olderCandidates = await this.feedItemModel
          .find({
            userId,
            createdAt: { $lt: oldestTime },
          })
          .sort({ createdAt: -1 })
          .limit(this.CANDIDATE_POOL_SIZE)
          .lean();

        if (olderCandidates.length > 0) {
          this.logger.debug(
            `[FEED DEEP ARCHIVE EXPANSION] loaded=${olderCandidates.length} older posts for user=${userId}`,
          );

          const rankedOlder = await this.rankItems(
            userId,
            olderCandidates,
            query.mainEmotion,
          );

          const existingIds = new Set(
            await this.redis.lrange(sessionKey, 0, -1),
          );
          const newRankedIds = rankedOlder
            .map((x) => x.itemId)
            .filter((id) => !existingIds.has(id));

          if (newRankedIds.length > 0) {
            await this.redis.rpush(sessionKey, ...newRankedIds);
            await this.redis.expire(sessionKey, this.SESSION_TTL);
            totalSessionLength += newRankedIds.length;
          }

          const nextOldestCandidate =
            olderCandidates[olderCandidates.length - 1];
          if (nextOldestCandidate && nextOldestCandidate.createdAt) {
            await this.redis.hset(
              metaKey,
              "oldestCreatedAt",
              new Date(nextOldestCandidate.createdAt).getTime().toString(),
            );
            await this.redis.expire(metaKey, this.SESSION_TTL);
          }

          if (olderCandidates.length < this.CANDIDATE_POOL_SIZE) {
            await this.redis.hset(metaKey, "exhausted", "true");
            isExhausted = true;
          }
        } else {
          await this.redis.hset(metaKey, "exhausted", "true");
          isExhausted = true;
        }
      }

      if (totalSessionLength > 0 && sessionData.offset < totalSessionLength) {
        this.logger.debug(
          `[FEED SESSION HIT] user=${userId} session=${sessionData.sessionId} offset=${sessionData.offset}`,
        );

        const endOffset = sessionData.offset + limit - 1;
        const pageItemIds = await this.redis.lrange(
          sessionKey,
          sessionData.offset,
          endOffset,
        );

        const feedDTOs = await this.hydrateFeedPage(userId, pageItemIds);

        const nextOffset = sessionData.offset + pageItemIds.length;
        let hasMore =
          pageItemIds.length === limit && nextOffset < totalSessionLength;
        if (
          pageItemIds.length === limit &&
          !hasMore &&
          meta &&
          meta.oldestCreatedAt &&
          !isExhausted
        ) {
          hasMore = true;
        }

        const nextCursor = hasMore
          ? PersonalFeedHelper.encodeSessionCursor(
              sessionData.sessionId,
              nextOffset,
            )
          : null;

        return new CursorPageResponse(feedDTOs, nextCursor, hasMore);
      }

      if (totalSessionLength > 0 && sessionData.offset >= totalSessionLength) {
        return new CursorPageResponse([], null, false);
      }

      this.logger.warn(
        `[FEED SESSION MISS / EXPIRED] user=${userId} session=${sessionData.sessionId}. Fallback to new session.`,
      );
    }

    // ========================================================
    // 🆕 CASE B: FIRST PAGE / NEW SESSION SNAPSHOT CREATION
    // ========================================================
    const sessionId = randomUUID();

    const candidates = await this.feedItemModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(this.CANDIDATE_POOL_SIZE)
      .lean();

    this.logger.debug(
      `[FEED CANDIDATE GENERATION] candidates=${candidates.length} user=${userId}`,
    );

    if (candidates.length === 0) {
      return new CursorPageResponse([], null, false);
    }

    // Stage 2: Heavy Adaptive Re-ranking & Dual-tier Safety Guardrails
    const ranked = await this.rankItems(userId, candidates, query.mainEmotion);

    if (ranked.length === 0) {
      return new CursorPageResponse([], null, false);
    }

    // Persist ranked candidate IDs to Redis List
    const sessionKey = this.getSessionKey(userId, query.mainEmotion, sessionId);
    const rankedItemIds = ranked.map((x) => x.itemId);

    await this.redis.rpush(sessionKey, ...rankedItemIds);
    await this.redis.expire(sessionKey, this.SESSION_TTL);

    // Save session metadata for Deep Archive Historical Pagination
    const oldestCandidate = candidates[candidates.length - 1];
    if (oldestCandidate && oldestCandidate.createdAt) {
      const metaKey = this.getSessionMetaKey(
        userId,
        query.mainEmotion,
        sessionId,
      );
      await this.redis.hset(metaKey, {
        oldestCreatedAt: new Date(oldestCandidate.createdAt).getTime().toString(),
      });
      await this.redis.expire(metaKey, this.SESSION_TTL);
    }

    // Slice First Page
    const firstPageIds = rankedItemIds.slice(0, limit);
    const feedDTOs = await this.hydrateFeedPage(userId, firstPageIds);

    const hasMore = limit < rankedItemIds.length;
    const nextCursor = hasMore
      ? PersonalFeedHelper.encodeSessionCursor(sessionId, limit)
      : null;

    return new CursorPageResponse(feedDTOs, nextCursor, hasMore);
  }

  // ========================================================
  // 🧠 RANKING & DUAL-TIER SAFETY GUARDRAILS
  // ========================================================
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

    const distress = this.emotionService.calcDistress(emotionFeatures);

    const batchNow = Date.now();
    const result: { itemId: string; score: number }[] = [];

    for (const item of items) {
      const itemId = item._id?.toString();
      if (!itemId) continue;

      const recency = PersonalFeedHelper.calcRecency(item.createdAt, batchNow);
      const post = postMap.get(item.postId);

      if (!post) {
        if (mainEmotion) continue;
        result.push({
          itemId,
          score: recency * 0.7,
        });
        continue;
      }

      // 🛡️ TIER 1 SAFETY GUARDRAIL: System-wide Hard Drop (Mental Health Risk HIGH)
      const mentalHealthRiskLevel =
        post.emotionFeature?.mentalHealthRiskLevel || (post as any).mentalHealthRiskLevel;

      if (mentalHealthRiskLevel === "HIGH" || mentalHealthRiskLevel === "high") {
        this.logger.warn(
          `[SAFETY GUARDRAIL] Dropped HIGH mental health risk post: postId=${post.postId}`,
        );
        continue;
      }

      // 🛡️ TIER 2 SAFETY GUARDRAIL: Contextual Protection for Distressed User
      if (distress > 0.5) {
        if (post.hasWarning || post.emotionFeature?.isSarcasmOrConflict) {
          continue;
        }

        const scores = post.emotionFeature?.scores || {};
        const anger = Number(scores.anger) || 0;
        const fear = Number(scores.fear) || 0;
        if (anger + fear > 0.5) {
          continue;
        }
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

      const postScores = post.emotionFeature?.scores || {};
      const toxicity =
        0.5 * (Number(postScores.anger) || 0) +
        0.3 * (Number(postScores.fear) || 0) +
        0.2 * (Number(postScores.disgust) || 0);

      const score = PersonalFeedHelper.calcAdaptiveScore({
        recency,
        emotion: emotionScore,
        affinity: affinityScore,
        engagement,
        distress,
        toxicity,
      });

      result.push({
        itemId,
        score,
      });
    }

    return result.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.itemId.localeCompare(a.itemId);
    });
  }

  // ========================================================
  // 💧 HYDRATION & ENRICHMENT PIPELINE
  // ========================================================
  private async hydrateFeedPage(
    userId: string,
    itemIds: string[],
  ): Promise<FeedItemDTO[]> {
    if (!itemIds.length) return [];

    const feedItems = await this.feedItemModel
      .find({ _id: { $in: itemIds } })
      .lean();

    const itemMap = new Map(feedItems.map((i) => [i._id.toString(), i]));

    const orderedItems = itemIds
      .map((id) => itemMap.get(id))
      .filter(Boolean) as FeedItem[];

    const { postMapFull, shareMapFull, postReactions, shareReactions } =
      await this.enrichFinalItems(userId, orderedItems);

    return this.buildFeedDTO(
      orderedItems,
      postMapFull,
      shareMapFull,
      postReactions,
      shareReactions,
    );
  }

  private async loadLightPosts(items: FeedItem[], mainEmotion?: string) {
    const postIds = Array.from(new Set(items.map((i) => i.postId)));

    const posts = await this.snapshotRepo.findPostsForRanking(
      postIds,
      mainEmotion ? mainEmotion.toLowerCase() : undefined,
    );

    return new Map(posts.map((p) => [p.postId, p]));
  }

  private getSessionKey(
    userId: string,
    mainEmotion?: string,
    sessionId?: string,
  ): string {
    const emotion = mainEmotion?.toLowerCase() || "all";
    return `feed:session:${userId}:${emotion}:${sessionId}`;
  }

  private getSessionMetaKey(
    userId: string,
    mainEmotion?: string,
    sessionId?: string,
  ): string {
    const emotion = mainEmotion?.toLowerCase() || "all";
    return `feed:meta:${userId}:${emotion}:${sessionId}`;
  }

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
          `[FEED] Missing POST postId=${item.postId} itemId=${id}. Removing orphan feed item.`,
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

      // ======================
      // POST
      // ======================
      if (item.eventType === FeedEventType.POST) {
        result.push({
          id,
          type: FeedEventType.POST,
          item: SnapshotMapper.toPostSnapshotDTO(
            post,
            postReactions[item.postId],
          ),
        });

        continue;
      }

      // ======================
      // SHARE
      // ======================
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
        ),
      });
    }

    return result;
  }
}
