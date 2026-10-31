import { Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import {
  CursorPageResponse,
  EmotionRankingFeaturesDto,
  FeedItemDTO,
  ModerationAction,
  RiskHintLevel,
  TrendingQuery,
} from "@repo/dtos";
import { SnapshotRepository } from "../../mongo/repository/snapshot.repository";
import { EmotionFeatureService } from "../../ranking/services/emotion-feature.service";
import { AffinityService } from "../../affinity/affinity.service";
import { ScoreCombinerService } from "../../ranking/services/score-combiner.service";
import { FeedInterleaverService } from "./feed-interleaver.service";
import { FeedHydrationService } from "./feed-hydration.service";
import { PersonalFeedHelper } from "../helpers/personal-feed.helper";

type RankFeature = {
  label: string;
  scores: Record<string, number>;
  confidence: number;
  dominantScene?: string;
  riskHintLevel?: RiskHintLevel;
  mentalHealthRiskLevel?: string;
  authorId?: string;
  moderationAction?: ModerationAction;
  needsMentalSupport?: boolean;
};

type Candidate = {
  postId: string;
  baseScore: number;
  feature: RankFeature;
};

type ScoredCandidate = {
  postId: string;
  finalScore: number;
  baseScore: number;
  feature: RankFeature;
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
    private readonly interleaverService: FeedInterleaverService,
    private readonly hydrationService: FeedHydrationService,
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
      // using an offset-based accumulation loop to prevent O(N^2) scan-limit starvation.
      if (
        sessionData.offset + limit > totalLen &&
        meta &&
        meta.zsetKey &&
        !isExhausted
      ) {
        const BATCH_SIZE = 50;
        const MAX_FETCH_ATTEMPTS = 4;
        let currentZsetOffset = parseInt(
          meta.zsetOffset || meta.fetchedOffset || "0",
          10,
        );
        const currentIds = new Set(await this.redis.lrange(sessionKey, 0, -1));

        const [emotionFeatures, affinity] = await Promise.all([
          userId ? this.emotionService.getEmotionFeatures(userId) : null,
          userId ? this.affinityService.getAffinity(userId) : null,
        ]);
        const userDistress = emotionFeatures
          ? this.emotionService.calcDistress(emotionFeatures)
          : 0;

        let attempt = 0;
        while (
          sessionData.offset + limit > totalLen &&
          !isExhausted &&
          attempt < MAX_FETCH_ATTEMPTS
        ) {
          attempt++;

          const nextZset = await this.redis.zrevrangebyscore(
            meta.zsetKey,
            "+inf",
            "-inf",
            "WITHSCORES",
            "LIMIT",
            currentZsetOffset,
            BATCH_SIZE,
          );

          if (!nextZset || nextZset.length === 0) {
            isExhausted = true;
            break;
          }

          const nextCandidates = this.parseZset(nextZset);
          currentZsetOffset += nextCandidates.length;

          if (nextCandidates.length < BATCH_SIZE) {
            isExhausted = true;
          }

          const newCandidates = nextCandidates.filter(
            (c) => !currentIds.has(c.postId),
          );

          if (newCandidates.length > 0) {
            const newIds = await this.processAndRankCandidates(
              newCandidates,
              userId,
              emotionFeatures,
              affinity,
              userDistress,
              meta.mainEmotion,
            );

            if (newIds.length > 0) {
              await this.redis.rpush(sessionKey, ...newIds);
              await this.redis.expire(sessionKey, this.SESSION_TTL);
              for (const id of newIds) {
                currentIds.add(id);
              }
              totalLen += newIds.length;
            }
          }
        }

        await this.redis.hset(metaKey, {
          zsetOffset: currentZsetOffset.toString(),
          exhausted: isExhausted ? "true" : "false",
        });
        await this.redis.expire(metaKey, this.SESSION_TTL);
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

        const items = await this.hydrationService.hydratePostPage(
          pageIds,
          userId,
        );

        const nextOffset = sessionData.offset + pageIds.length;
        let hasMore = nextOffset < totalLen || !isExhausted;
        if (pageIds.length === 0) {
          hasMore = false;
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

    // Load User Context & Emotion Features
    const [emotionFeatures, affinity] = await Promise.all([
      userId ? this.emotionService.getEmotionFeatures(userId) : null,
      userId ? this.affinityService.getAffinity(userId) : null,
    ]);

    const userDistress = emotionFeatures
      ? this.emotionService.calcDistress(emotionFeatures)
      : 0;

    const rankedPostIds = await this.processAndRankCandidates(
      candidatesRaw,
      userId,
      emotionFeatures,
      affinity,
      userDistress,
      mainEmotion,
    );

    if (!rankedPostIds.length) {
      return new CursorPageResponse([], null, false);
    }

    // ==============================
    // 8️⃣ Persist to Redis Session List
    // ==============================
    const sessionKey = `trending:session:${sessionId}`;
    await this.redis.rpush(sessionKey, ...rankedPostIds);
    await this.redis.expire(sessionKey, this.SESSION_TTL);

    // Save session metadata for Two-Tier Infinite Discovery
    const metaKey = `trending:meta:${sessionId}`;
    await this.redis.hset(metaKey, {
      zsetKey: key,
      mainEmotion: mainEmotion || "",
      zsetOffset: candidatesRaw.length.toString(),
      fetchedOffset: candidatesRaw.length.toString(),
    });
    await this.redis.expire(metaKey, this.SESSION_TTL);

    // ==============================
    // 9️⃣ Slice Page 1 & Hydrate
    // ==============================
    const firstPageIds = rankedPostIds.slice(0, limit);
    const items = await this.hydrationService.hydratePostPage(
      firstPageIds,
      userId,
    );
    const finalItems = userId
      ? await this.interleaverService.maybeInterleaveSafeSpaceCard(
          userId,
          items,
          0,
          userDistress,
          limit,
        )
      : items;

    const hasMore = limit < rankedPostIds.length;
    const nextCursor = hasMore
      ? PersonalFeedHelper.encodeSessionCursor(sessionId, limit)
      : null;

    return new CursorPageResponse(finalItems, nextCursor, hasMore);
  }

  // ========================================================
  // 🛡️ DUAL-STAGE ANTI-DOOMSCROLLING CANDIDATE PIPELINE
  // ========================================================
  private async processAndRankCandidates(
    candidatesRaw: { postId: string; score: number }[],
    userId?: string,
    emotionFeatures?: EmotionRankingFeaturesDto | null,
    affinity?: any,
    userDistress = 0,
    mainEmotion?: string,
  ): Promise<string[]> {
    if (!candidatesRaw.length) return [];

    // 1️⃣ Load rank features in batch
    const pipeline = this.redis.pipeline();
    for (const c of candidatesRaw) {
      pipeline.hgetall(`post:rank:${c.postId}`);
    }

    const rankResults = await pipeline.exec();
    const candidates: Candidate[] = [];
    const missingFeatureCandidates: { postId: string; score: number }[] = [];

    candidatesRaw.forEach((c, idx) => {
      const rank = rankResults?.[idx]?.[1] as
        | Record<string, string>
        | undefined;

      if (!rank || !rank.scores) {
        missingFeatureCandidates.push(c);
        return;
      }

      try {
        candidates.push({
          postId: c.postId,
          baseScore: c.score,
          feature: {
            label: rank.label || "",
            scores: JSON.parse(rank.scores),
            confidence: Number(rank.confidence || 0),
            dominantScene: rank.dominantScene,
            riskHintLevel: rank.riskHintLevel as RiskHintLevel,
            mentalHealthRiskLevel: rank.mentalHealthRiskLevel,
            authorId: rank.authorId,
            moderationAction: rank.moderationAction as ModerationAction,
            needsMentalSupport: rank.needsMentalSupport === "true",
          },
        });
      } catch {
        missingFeatureCandidates.push(c);
      }
    });

    // 🛡️ Safety Fallback: Nếu thiếu rank feature trên Redis, query MongoDB Snapshot để kiểm tra
    // Tránh việc bypass safety guardrails do Redis cache miss
    if (missingFeatureCandidates.length > 0) {
      const missingIds = missingFeatureCandidates.map((c) => c.postId);
      const dbSnapshots =
        await this.snapshotRepo.findPostsForRanking(missingIds);
      const snapshotMap = new Map(dbSnapshots.map((s) => [s.postId, s]));

      for (const c of missingFeatureCandidates) {
        const snap = snapshotMap.get(c.postId);
        if (!snap || (snap as any).isDeleted) {
          // Bài viết không tồn tại trong snapshot hoặc đã bị xóa -> Bỏ qua an toàn
          continue;
        }

        candidates.push({
          postId: c.postId,
          baseScore: c.score,
          feature: {
            label: snap.emotionFeature?.label || "",
            scores: snap.emotionFeature?.scores || {},
            confidence: Number(snap.emotionFeature?.confidence || 0),
            dominantScene: (snap.emotionFeature as any)?.dominantScene,
            riskHintLevel: (snap.emotionFeature as any)
              ?.riskHintLevel as RiskHintLevel,
            mentalHealthRiskLevel: snap.emotionFeature?.mentalHealthRiskLevel,
            authorId: snap.userId,
            moderationAction: (snap as any)
              .moderationAction as ModerationAction,
            needsMentalSupport: (snap as any).needsMentalSupport,
          },
        });
      }
    }

    // 2️⃣ Safety Guardrails Filter
    const safeCandidates = candidates.filter((item) => {
      // 🛡️ Tier 1: System-wide Hard Drop
      if (
        item.feature.moderationAction === ModerationAction.HARD_BLOCK ||
        ((item.feature.mentalHealthRiskLevel === "HIGH" ||
          item.feature.mentalHealthRiskLevel === "high" ||
          item.feature.riskHintLevel === RiskHintLevel.HIGH) &&
          item.feature.moderationAction !== ModerationAction.ALLOW_WITH_SUPPORT)
      ) {
        return false;
      }

      // 🛡️ Trending Virality Guardrail: Khủng hoảng tâm lý cá nhân không được đưa lên Bảng tin Xu hướng toàn cầu
      if (
        item.feature.needsMentalSupport ||
        item.feature.moderationAction === ModerationAction.ALLOW_WITH_SUPPORT
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
      return [];
    }

    // 3️⃣ Re-rank (Personalized or Base)
    const scored: ScoredCandidate[] = safeCandidates.map((item) => {
      const base = this.normalize(item.baseScore);

      if (mainEmotion || !userId) {
        return {
          postId: item.postId,
          finalScore: base,
          baseScore: item.baseScore,
          feature: item.feature,
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
        feature: item.feature,
      };
    });

    // 4️⃣ Sort by Final Score DESC
    scored.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return b.baseScore - a.baseScore;
    });

    // 5️⃣ Anti-Doomscrolling: Tail Pruning & Pacing (khi userDistress > 0.3 và không lọc theo mainEmotion cụ thể)
    if (userDistress > 0.3 && !mainEmotion) {
      return this.applyAntiDoomscrollingPacing(scored, userDistress);
    }

    return scored.map((s) => s.postId);
  }

  // ========================================================
  // 🛡️ ANTI-DOOMSCROLLING: TAIL PRUNING & PACING LOGIC
  // ========================================================
  private applyAntiDoomscrollingPacing(
    scored: ScoredCandidate[],
    userDistress: number,
  ): string[] {
    // 🛡️ Bước 1: Tail Pruning - Cắt bỏ các bài có sắc thái u uất/buồn mà điểm thấp ở đuôi
    const pruned = scored.filter((item) => {
      const sadness = Number(item.feature.scores?.sadness) || 0;

      // Loại bỏ bài u buồn có điểm xếp hạng thấp (finalScore < 0.25)
      if (sadness > 0.4 && item.finalScore < 0.25) {
        return false;
      }

      // Nếu user đang khủng hoảng nặng (distress > 0.5), loại bỏ triệt để các bài có sadness > 0.6
      if (userDistress > 0.5 && sadness > 0.7) {
        return false;
      }

      return true;
    });

    // 🛡️ Bước 2: Anti-Clustering Pacing - Đảm bảo không bao giờ có 2 bài buồn đứng cạnh nhau
    const paced: ScoredCandidate[] = [];
    const sadQueue: ScoredCandidate[] = [];
    const nonSadQueue: ScoredCandidate[] = [];

    for (const item of pruned) {
      const sadness = Number(item.feature.scores?.sadness) || 0;
      if (sadness > 0.35) {
        sadQueue.push(item);
      } else {
        nonSadQueue.push(item);
      }
    }

    let lastWasSad = false;
    while (sadQueue.length > 0 || nonSadQueue.length > 0) {
      if (!lastWasSad && sadQueue.length > 0 && nonSadQueue.length > 0) {
        if (sadQueue[0].finalScore >= nonSadQueue[0].finalScore) {
          paced.push(sadQueue.shift()!);
          lastWasSad = true;
        } else {
          paced.push(nonSadQueue.shift()!);
          lastWasSad = false;
        }
      } else if (lastWasSad) {
        // Sau bài buồn BẮT BUỘC phải là bài non-sad (xoa dịu/tích cực)
        if (nonSadQueue.length > 0) {
          paced.push(nonSadQueue.shift()!);
          lastWasSad = false;
        } else {
          // Hết bài non-sad: Dừng lại để tránh tạo cụm bài buồn ở đáy
          break;
        }
      } else {
        // Chỉ còn 1 trong 2 hàng đợi
        if (nonSadQueue.length > 0) {
          paced.push(nonSadQueue.shift()!);
          lastWasSad = false;
        } else {
          // Chỉ còn sadQueue nhưng lastWasSad là false -> chỉ lấy tối đa 1 bài nhẹ
          if (sadQueue.length > 0) {
            paced.push(sadQueue.shift()!);
          }
          break;
        }
      }
    }

    return paced.map((p) => p.postId);
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
