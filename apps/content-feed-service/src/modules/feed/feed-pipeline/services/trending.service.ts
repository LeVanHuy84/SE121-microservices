import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import {
  CursorPageResponse,
  FeedEventType,
  FeedItemDTO,
  RiskHintLevel,
  TargetType,
  TrendingQuery,
} from "@repo/dtos";
import { SnapshotRepository } from "../../mongo/repository/snapshot.repository";
import { SnapshotMapper } from "src/common/snapshot.mapper";
import { EmotionFeatureService } from "../../ranking/services/emotion-feature.service";
import { AffinityService } from "../../affinity/affinity.service";
import { ScoreCombinerService } from "../../ranking/services/score-combiner.service";
import { ReactionService } from "../../../post/reaction/reaction.service";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";
import { UserClientService } from "../../../post/client/user-client.service";
import { MICROSERVICES_CLIENT } from "src/constant";
import { PersonalFeedHelper } from "../helpers/personal-feed.helper";

type RankFeature = {
  label: string;
  scores: Record<string, number>;
  intensity: number;
  confidence: number;
  dominantScene?: string;
  riskHintLevel?: RiskHintLevel;
  mentalHealthRiskLevel?: string;
  authorId?: string;
};

type Candidate = {
  postId: string;
  baseScore: number;
  feature: RankFeature;
};

type CursorPayload = {
  baseScore: number;
  postId: string;
};

@Injectable()
export class TrendingService {
  private readonly DEFAULT_PAGE_SIZE = 10;
  private readonly SESSION_TTL = 1200; // 20 minutes in seconds
  private readonly TRENDING_CANDIDATE_POOL = 100;
  private readonly logger = new Logger(TrendingService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotRepo: SnapshotRepository,
    private readonly emotionService: EmotionFeatureService,
    private readonly affinityService: AffinityService,
    private readonly combiner: ScoreCombinerService,
    private readonly reactionService: ReactionService,
    private readonly userClient: UserClientService,
    @Inject(MICROSERVICES_CLIENT.USER_SOCIAL_SERVICE)
    private readonly userSocialClient: ClientProxy,
  ) {}

  async getTrendingPosts(
    query: TrendingQuery,
    userId?: string,
  ): Promise<CursorPageResponse<FeedItemDTO>> {
    const limit = query.limit ?? this.DEFAULT_PAGE_SIZE;
    const sessionData = PersonalFeedHelper.decodeSessionCursor(query.cursor);

    // ========================================================
    // 🔁 CASE A: SUBSEQUENT PAGE FROM REDIS SESSION SNAPSHOT
    // ========================================================
    if (sessionData) {
      const sessionKey = `trending:session:${sessionData.sessionId}`;
      const metaKey = `trending:meta:${sessionData.sessionId}`;
      let totalLen = await this.redis.llen(sessionKey);
      const meta = await this.redis.hgetall(metaKey);
      let isExhausted = meta?.exhausted === "true";

      // 🚀 Two-Tier Infinite Discovery: If session is nearing exhaustion,
      // dynamically fetch the next batch of viral candidates from Redis ZSET
      if (
        sessionData.offset + limit > totalLen &&
        meta &&
        meta.zsetKey &&
        !isExhausted
      ) {
        const BATCH_SIZE = 50;
        const currentIds = new Set(await this.redis.lrange(sessionKey, 0, -1));
        const scanLimit = currentIds.size + BATCH_SIZE;

        const nextZset = await this.redis.zrevrangebyscore(
          meta.zsetKey,
          "+inf",
          "-inf",
          "WITHSCORES",
          "LIMIT",
          0,
          scanLimit,
        );

        if (nextZset.length > 0) {
          const nextCandidates = this.parseZset(nextZset);
          const newIds = nextCandidates
            .map((c) => c.postId)
            .filter((id) => !currentIds.has(id));

          if (newIds.length > 0) {
            await this.redis.rpush(sessionKey, ...newIds);
            await this.redis.expire(sessionKey, this.SESSION_TTL);
            totalLen += newIds.length;
          }

          if (newIds.length === 0 || nextZset.length < scanLimit) {
            await this.redis.hset(metaKey, "exhausted", "true");
            isExhausted = true;
          }
        } else {
          await this.redis.hset(metaKey, "exhausted", "true");
          isExhausted = true;
        }
      }

      if (totalLen > 0 && sessionData.offset < totalLen) {
        this.logger.debug(
          `[TRENDING SESSION HIT] session=${sessionData.sessionId} offset=${sessionData.offset}`,
        );

        const pageIds = await this.redis.lrange(
          sessionKey,
          sessionData.offset,
          sessionData.offset + limit - 1,
        );

        const items = await this.hydrateTrendingPage(pageIds, userId);

        const nextOffset = sessionData.offset + pageIds.length;
        let hasMore =
          pageIds.length === limit && nextOffset < totalLen;
        if (
          pageIds.length === limit &&
          !hasMore &&
          meta &&
          meta.zsetKey &&
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

        return new CursorPageResponse(items, nextCursor, hasMore);
      }

      if (totalLen > 0 && sessionData.offset >= totalLen) {
        return new CursorPageResponse([], null, false);
      }

      this.logger.warn(
        `[TRENDING SESSION MISS] session=${sessionData.sessionId}. Fallback to new session.`,
      );
    }

    // ========================================================
    // 🆕 CASE B: FIRST PAGE / NEW TRENDING SESSION SNAPSHOT
    // ========================================================
    const sessionId = randomUUID();
    const mainEmotion = query.mainEmotion?.toLowerCase();

    let key = "post:score";
    if (mainEmotion) {
      key = `post:emotion:${mainEmotion}:score`;
    }

    // Lấy Top 100 bài ứng viên từ Redis ZSET
    const zset = await this.redis.zrevrangebyscore(
      key,
      "+inf",
      "-inf",
      "WITHSCORES",
      "LIMIT",
      0,
      this.TRENDING_CANDIDATE_POOL,
    );

    const candidatesRaw = this.parseZset(zset);

    this.logger.debug(
      `[Trending] Initial ZSET candidates count: ${candidatesRaw.length}`,
    );

    if (!candidatesRaw.length) {
      return new CursorPageResponse([], null, false);
    }

    // ==============================
    // 3️⃣ Load rank features in batch
    // ==============================
    const pipeline = this.redis.pipeline();
    for (const c of candidatesRaw) {
      pipeline.hgetall(`post:rank:${c.postId}`);
    }

    const rankResults = await pipeline.exec();
    const candidates: Candidate[] = [];

    candidatesRaw.forEach((c, idx) => {
      const rank = rankResults?.[idx]?.[1] as
        | Record<string, string>
        | undefined;

      if (!rank || !rank.scores) {
        candidates.push({
          postId: c.postId,
          baseScore: c.score,
          feature: {
            label: "",
            scores: {},
            intensity: 0,
            confidence: 0,
          },
        });
        return;
      }

      try {
        candidates.push({
          postId: c.postId,
          baseScore: c.score,
          feature: {
            label: rank.label || "",
            scores: JSON.parse(rank.scores),
            intensity: Number(rank.intensity || 0),
            confidence: Number(rank.confidence || 0),
            dominantScene: rank.dominantScene,
            riskHintLevel: rank.riskHintLevel as RiskHintLevel,
            mentalHealthRiskLevel: rank.mentalHealthRiskLevel,
            authorId: rank.authorId,
          },
        });
      } catch {
        candidates.push({
          postId: c.postId,
          baseScore: c.score,
          feature: {
            label: "",
            scores: {},
            intensity: 0,
            confidence: 0,
          },
        });
      }
    });

    // ==============================
    // 4️⃣ User Context & Emotion Features
    // ==============================
    const [emotionFeatures, affinity] = await Promise.all([
      userId ? this.emotionService.getEmotionFeatures(userId) : null,
      userId ? this.affinityService.getAffinity(userId) : null,
    ]);

    const userDistress = emotionFeatures
      ? this.emotionService.calcDistress(emotionFeatures)
      : 0;

    // ==============================
    // 5️⃣ Safety Guardrails Filter
    // ==============================
    const safeCandidates = candidates.filter((item) => {
      // 🛡️ Tier 1: System-wide Hard Drop (Mental Health Risk HIGH)
      if (
        item.feature.mentalHealthRiskLevel === "HIGH" ||
        item.feature.mentalHealthRiskLevel === "high" ||
        item.feature.riskHintLevel === RiskHintLevel.HIGH
      ) {
        return false;
      }

      // 🛡️ Tier 2: Contextual Safety Guardrail for Distressed Users
      if (userDistress > 0.5) {
        if (item.feature.riskHintLevel === RiskHintLevel.MEDIUM) {
          return false;
        }
        const anger = Number(item.feature.scores?.anger) || 0;
        const fear = Number(item.feature.scores?.fear) || 0;
        if (anger + fear > 0.5) {
          return false;
        }
      }

      return true;
    });

    if (!safeCandidates.length) {
      return new CursorPageResponse([], null, false);
    }

    // ==============================
    // 6️⃣ Re-rank (Personalized or Base)
    // ==============================
    const scored = safeCandidates.map((item) => {
      const base = this.normalize(item.baseScore);

      if (mainEmotion || !userId) {
        return {
          postId: item.postId,
          finalScore: base,
          baseScore: item.baseScore,
        };
      }

      const emotion = emotionFeatures
        ? this.emotionService.calcEmotionScore(emotionFeatures, item.feature)
        : 0;

      const affinityScore =
        affinity && item.feature.authorId
          ? this.affinityService.calcAffinityScore(affinity, {
              category: item.feature.dominantScene || "",
              authorId: item.feature.authorId,
            })
          : 0;

      const finalScore = this.combiner.combine({
        base: item.baseScore,
        emotion,
        affinity: affinityScore,
        riskScore: emotionFeatures?.riskScore,
        recentNegativityScore: emotionFeatures?.recentNegativityScore,
      });

      return {
        postId: item.postId,
        finalScore,
        baseScore: item.baseScore,
      };
    });

    // ==============================
    // 7️⃣ Sort by Final Score DESC
    // ==============================
    scored.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return b.baseScore - a.baseScore;
    });

    // ==============================
    // 8️⃣ Persist to Redis Session List
    // ==============================
    const sessionKey = `trending:session:${sessionId}`;
    const rankedPostIds = scored.map((s) => s.postId);

    await this.redis.rpush(sessionKey, ...rankedPostIds);
    await this.redis.expire(sessionKey, this.SESSION_TTL);

    // Save session metadata for Two-Tier Infinite Discovery
    const metaKey = `trending:meta:${sessionId}`;
    await this.redis.hset(metaKey, {
      zsetKey: key,
      fetchedOffset: candidatesRaw.length.toString(),
    });
    await this.redis.expire(metaKey, this.SESSION_TTL);

    // ==============================
    // 9️⃣ Slice Page 1 & Hydrate
    // ==============================
    const firstPageIds = rankedPostIds.slice(0, limit);
    const items = await this.hydrateTrendingPage(firstPageIds, userId);

    const hasMore = limit < rankedPostIds.length;
    const nextCursor = hasMore
      ? PersonalFeedHelper.encodeSessionCursor(sessionId, limit)
      : null;

    return new CursorPageResponse(items, nextCursor, hasMore);
  }

  // ==============================
  // 💧 HYDRATION PIPELINE
  // ==============================
  private async hydrateTrendingPage(
    topIds: string[],
    userId?: string,
  ): Promise<FeedItemDTO[]> {
    if (!topIds.length) return [];

    const posts = await this.snapshotRepo.findPostsByIds(topIds);
    const postMap = new Map(posts.map((p) => [p.postId, p]));

    const orderedPosts = topIds
      .map((id) => postMap.get(id))
      .filter((p): p is any => !!p);

    const [reactions, groups, users] = await Promise.all([
      userId
        ? this.reactionService.getReactedTypesBatch(
            userId,
            TargetType.POST,
            orderedPosts.map((p) => p.postId),
          )
        : Promise.resolve({}),
      this.fetchGroups(orderedPosts),
      this.fetchUsers(orderedPosts),
    ]);

    return orderedPosts.map((post) => {
      if (post.groupId) {
        post.group = groups.get(post.groupId);
      }
      if (post.userId) {
        post.user = users[post.userId];
      }

      return {
        id: post.postId,
        type: FeedEventType.POST,
        item: SnapshotMapper.toPostSnapshotDTO(post, reactions[post.postId]),
      };
    });
  }

  // ==============================
  // 👥 ENRICHMENT HELPERS
  // ==============================
  private async fetchGroups(posts: any[]) {
    const groupIds = Array.from(
      new Set(posts.map((p) => p.groupId).filter(Boolean)),
    );

    if (!groupIds.length) return new Map();

    const groups = await firstValueFrom(
      this.userSocialClient.send<any[]>("get_group_info_batch", groupIds),
    );

    return new Map(groups.map((g) => [g.id, g]));
  }

  private async fetchUsers(posts: any[]) {
    const userIds = Array.from(
      new Set(posts.map((p) => p.userId).filter(Boolean)),
    );

    if (!userIds.length) return {};

    return this.userClient.getUserInfos(userIds);
  }

  // ==============================
  // 🧮 HELPERS
  // ==============================
  private parseZset(zset: string[]): { postId: string; score: number }[] {
    const result: { postId: string; score: number }[] = [];

    for (let i = 0; i < zset.length; i += 2) {
      result.push({
        postId: zset[i],
        score: parseFloat(zset[i + 1]),
      });
    }

    return result;
  }

  private normalize(score: number): number {
    return this.combiner.normalizeBaseScore(score);
  }
}
