import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CursorPageResponse,
  FeedEventType,
  FeedItemDTO,
  PersonalFeedQuery,
  ReactionType,
  TargetType,
} from '@repo/dtos';
import { FeedItem, FeedItemDocument } from 'src/mongo/schema/feed-item.schema';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { SnapshotMapper } from 'src/common/snapshot.mapper';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { PersonalFeedHelper } from '../helpers/personal-feed.helper';
import { AffinityService } from 'src/modules/affinity/affinity.service';
import { EmotionFeatureService } from 'src/modules/ranking/services/emotion-feature.service';

@Injectable()
export class PersonalFeedService {
  private readonly logger = new Logger(PersonalFeedService.name);

  constructor(
    @InjectModel(FeedItem.name)
    private readonly feedItemModel: Model<FeedItemDocument>,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject('GROUP_SERVICE') private readonly groupClient: ClientProxy,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy,
    private readonly affinityService: AffinityService,
    private readonly emotionService: EmotionFeatureService,
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
            intensity: post.emotionFeature?.intensity,
            confidence: post.emotionFeature?.confidence,
            riskHintLevel: post.emotionFeature?.riskHintLevel,
          })
        : 0;

      const affinityScore = this.affinityService.calcAffinityScore(affinity, {
        category: post.emotionFeature?.label || 'neutral',
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
    const postIds: string[] = [];
    const shareIds: string[] = [];

    for (const item of items) {
      if (item.eventType === FeedEventType.POST) {
        postIds.push(item.refId);
      } else {
        shareIds.push(item.refId);
      }
    }

    const [posts, shares] = await Promise.all([
      this.snapshotRepo.findPostsByIds(postIds),
      this.snapshotRepo.findSharesByIds(shareIds),
    ]);

    const postMap = new Map(posts.map((p) => [p.postId, p]));
    const shareMap = new Map(shares.map((s) => [s.shareId, s]));

    /**
     * LOAD REACTIONS (ONLY FINAL)
     */
    const [postReactions, shareReactions] = await Promise.all([
      postIds.length
        ? firstValueFrom(
            this.postClient.send<Record<string, ReactionType>>(
              'get_reacted_types_batch',
              {
                userId,
                targetType: TargetType.POST,
                targetIds: postIds,
              },
            ),
          )
        : Promise.resolve({}),
      shareIds.length
        ? firstValueFrom(
            this.postClient.send<Record<string, ReactionType>>(
              'get_reacted_types_batch',
              {
                userId,
                targetType: TargetType.SHARE,
                targetIds: shareIds,
              },
            ),
          )
        : Promise.resolve({}),
    ]);

    /**
     * LOAD GROUP
     */
    const groupIds = new Set<string>();
    for (const p of posts) {
      if (p.groupId) groupIds.add(p.groupId);
    }

    const groupMap = new Map<string, any>();

    if (groupIds.size > 0) {
      const groups = await firstValueFrom(
        this.groupClient.send<any[]>(
          'get_group_info_batch',
          Array.from(groupIds),
        ),
      );

      for (const g of groups) {
        groupMap.set(g.id, g);
      }
    }

    for (const post of posts) {
      if (post.groupId) {
        (post as any).group = groupMap.get(post.groupId);
      }
    }

    for (const share of shares) {
      const post = postMap.get(share.postId);
      if (post?.groupId) {
        (share as any).group = groupMap.get(post.groupId);
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
      if (item.eventType === FeedEventType.POST) {
        const post = postMap.get(item.refId);
        if (!post) continue;

        result.push({
          id: item._id?.toString() ?? '',
          type: FeedEventType.POST,
          item: SnapshotMapper.toPostSnapshotDTO(
            post,
            postReactions[item.refId],
          ),
        });
      } else {
        const share = shareMap.get(item.refId);
        if (!share) continue;

        const post = postMap.get(share.postId);
        if (!post) continue;

        result.push({
          id: item._id?.toString() ?? '',
          type: FeedEventType.SHARE,
          item: SnapshotMapper.toShareSnapshotDTO(
            share,
            post,
            shareReactions[item.refId],
          ),
        });
      }
    }

    return result;
  }
}
