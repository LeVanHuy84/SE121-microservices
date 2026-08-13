import { InjectRedis } from '@nestjs-modules/ioredis';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CursorPageResponse,
  ReactionType,
  RiskHintLevel,
  TargetType,
  TrendingQuery,
} from '@repo/dtos';
import Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';
import { SnapshotMapper } from 'src/common/snapshot.mapper';
import { AffinityService } from 'src/modules/affinity/affinity.service';
import { EmotionFeatureService } from 'src/modules/ranking/services/emotion-feature.service';
import { ScoreCombinerService } from 'src/modules/ranking/services/score-combiner.service';
import { SnapshotRepository } from '../../mongo/repository/snapshot.repository';
import { ReactionService } from '../../../post/reaction/reaction.service';

import { UserClientService } from '../../../post/client/user-client.service';
import { MICROSERVICES_CLIENT } from 'src/constant';

type RankFeature = {
  label: string;
  scores: Record<string, number>;
  intensity: number;
  confidence: number;
  dominantScene?: string;
  riskHintLevel?: RiskHintLevel;
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
  ): Promise<CursorPageResponse<any>> {
    const { cursor, limit = this.DEFAULT_PAGE_SIZE, mainEmotion } = query;

    const candidateSize = mainEmotion ? limit : Math.max(limit * 10, 100);

    const key = mainEmotion
      ? `post:emotion:${mainEmotion.toLocaleLowerCase()}:score`
      : 'post:score';

    // ==============================
    // 1️⃣ Decode cursor (BASE ONLY)
    // ==============================
    let cursorData: CursorPayload | null = null;

    if (cursor) {
      cursorData = this.decodeCursor(cursor);
    }

    // ==============================
    // 2️⃣ Query Redis (SOURCE OF TRUTH)
    // ==============================
    const max = cursorData ? `(${cursorData.baseScore}` : '+inf';

    const zset = await this.redis.zrevrangebyscore(
      key,
      max,
      '-inf',
      'WITHSCORES',
      'LIMIT',
      0,
      candidateSize,
    );

    const candidatesRaw = this.parseZset(zset);

    console.log('Candidates raw count:', candidatesRaw.length);

    if (!candidatesRaw.length) {
      return new CursorPageResponse([], null, false);
    }

    // ==============================
    // 3️⃣ Load rank features
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

      // Rank feature chưa tồn tại → fallback về base score
      if (!rank || !rank.scores) {
        candidates.push({
          postId: c.postId,
          baseScore: c.score,
          feature: {
            label: '',
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
            label: rank.label || '',
            scores: JSON.parse(rank.scores),
            intensity: Number(rank.intensity || 0),
            confidence: Number(rank.confidence || 0),
            dominantScene: rank.dominantScene,
            riskHintLevel: rank.riskHintLevel as RiskHintLevel,
            authorId: rank.authorId,
          },
        });
      } catch {
        // Corrupted rank feature → fallback về base score
        candidates.push({
          postId: c.postId,
          baseScore: c.score,
          feature: {
            label: '',
            scores: {},
            intensity: 0,
            confidence: 0,
          },
        });
      }
    });

    this.logger.debug(
      `[Trending] Redis candidates=${candidatesRaw.length}, valid candidates=${candidates.length}`,
    );

    if (!candidates.length) {
      return new CursorPageResponse([], null, false);
    }

    // ==============================
    // 4️⃣ User context
    // ==============================
    const [emotionFeatures, affinity] = await Promise.all([
      userId ? this.emotionService.getEmotionFeatures(userId) : null,
      userId ? this.affinityService.getAffinity(userId) : null,
    ]);

    this.logger.debug(
      `User ${userId} - Emotion features: ${JSON.stringify(
        emotionFeatures,
      )}, Affinity: ${JSON.stringify(affinity)}`,
    );

    // ==============================
    // 5️⃣ Re-rank (ONLY FOR DISPLAY)
    // ==============================
    const scored = candidates.map((item) => {
      const base = this.normalize(item.baseScore);

      if (mainEmotion) {
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
              category: item.feature.dominantScene || '',
              authorId: item.feature.authorId,
            })
          : 0;

      const finalScore = this.combiner.combine({
        base,
        emotion,
        affinity: affinityScore,
        riskScore: emotionFeatures?.riskScore,
        recentNegativityScore: emotionFeatures?.recentNegativityScore,
      });

      // this.logger.log(
      //   `User ${userId} - Post ${item.postId} - Base score: ${1 / (1 + Math.exp(-(base - 200) / 50))}, Emotion: ${emotion}, Affinity: ${affinityScore}, Final score: ${finalScore}`,
      // );

      return {
        postId: item.postId,
        finalScore,
        baseScore: item.baseScore,
      };
    });

    // ==============================
    // 6️⃣ Sort by FINAL SCORE (DISPLAY ONLY)
    // ==============================
    scored.sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return b.baseScore - a.baseScore;
    });

    // ==============================
    // 7️⃣ Take page
    // ==============================
    const page = scored.slice(0, limit);

    if (!page.length) {
      return new CursorPageResponse([], null, false);
    }

    // ==============================
    // 8️⃣ Hydrate DB
    // ==============================
    const topIds = page.map((p) => p.postId);

    const posts = await this.snapshotRepo.findPostsByIds(topIds);

    const postMap = new Map(posts.map((p) => [p.postId, p]));

    const orderedPosts = topIds
      .map((id) => postMap.get(id))
      .filter((p): p is any => !!p);

    const groupIds = new Set<string>();
    const userIds = new Set<string>();

    for (const p of orderedPosts) {
      if (p.groupId) groupIds.add(p.groupId);
      if (p.userId) userIds.add(p.userId);
    }

    const groupMap = new Map<string, any>();
    let userMap: Record<string, any> = {};

    const enrichmentPromises: Promise<any>[] = [];

    if (groupIds.size > 0) {
      enrichmentPromises.push(
        firstValueFrom(
          this.userSocialClient.send<any[]>(
            'get_group_info_batch',
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

    for (const post of orderedPosts) {
      if (post.groupId) {
        post.group = groupMap.get(post.groupId);
      }
      if (post.userId) {
        post.user = userMap[post.userId];
      }
    }

    // ==============================
    // 9️⃣ Reactions
    // ==============================
    let reactions: Record<string, ReactionType> = {};

    if (userId && orderedPosts.length) {
      try {
        reactions = await this.reactionService.getReactedTypesBatch(
          userId,
          TargetType.POST,
          orderedPosts.map((p) => p.postId),
        );
      } catch {}
    }

    const dtoPosts = SnapshotMapper.toPostSnapshotDTOs(orderedPosts, reactions);

    // ==============================
    // 🔟 Next cursor (BASE ONLY)
    // ==============================
    let nextCursor: string | null = null;

    if (candidatesRaw.length === candidateSize) {
      const last = candidatesRaw[candidatesRaw.length - 1];

      nextCursor = this.encodeCursor(last.score, last.postId);
    }

    return new CursorPageResponse(
      dtoPosts,
      nextCursor,
      candidatesRaw.length === candidateSize,
    );
  }

  // ==============================
  // Utils
  // ==============================

  private normalize(score: number): number {
    return score / 5;
  }

  private parseZset(zset: string[]) {
    const result: { postId: string; score: number }[] = [];

    for (let i = 0; i < zset.length; i += 2) {
      result.push({
        postId: zset[i],
        score: Number(zset[i + 1]),
      });
    }

    return result;
  }

  private encodeCursor(baseScore: number, postId: string): string {
    return `${baseScore}_${postId}`;
  }

  private decodeCursor(cursor: string): CursorPayload {
    const [baseScore, postId] = cursor.split('_');

    return {
      baseScore: Number(baseScore),
      postId,
    };
  }
}
