import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Not } from 'typeorm';
import { ProfileEmbedding } from '../entities/profile-embedding.entity';
import { RecommendationFriendship } from '../entities/recommendation-friendship.entity';
import { RecommendationPendingRequest } from '../entities/recommendation-pending-request.entity';
import { RecommendationBlock } from '../entities/recommendation-block.entity';
import { RecommendationDismissal } from '../entities/recommendation-dismissal.entity';
import { RecommendationGraphEventJournal } from '../entities/recommendation-graph-event-journal.entity';
import { RecommendationPairFeature } from '../entities/recommendation-pair-feature.entity';
import { RecommendationGlobalFallbackCandidate } from '../entities/recommendation-global-fallback-candidate.entity';
import { RecommendationEmotionProfile } from '../entities/recommendation-emotion-profile.entity';

@Injectable()
export class RecommendationStateRepository implements OnModuleInit {
  constructor(
    @InjectRepository(ProfileEmbedding)
    private readonly profileEmbeddingRepo: Repository<ProfileEmbedding>,
    @InjectRepository(RecommendationFriendship)
    private readonly friendshipRepo: Repository<RecommendationFriendship>,
    @InjectRepository(RecommendationPendingRequest)
    private readonly pendingRequestRepo: Repository<RecommendationPendingRequest>,
    @InjectRepository(RecommendationBlock)
    private readonly blockRepo: Repository<RecommendationBlock>,
    @InjectRepository(RecommendationDismissal)
    private readonly dismissalRepo: Repository<RecommendationDismissal>,
    @InjectRepository(RecommendationGraphEventJournal)
    private readonly graphEventRepo: Repository<RecommendationGraphEventJournal>,
    @InjectRepository(RecommendationPairFeature)
    private readonly pairFeatureRepo: Repository<RecommendationPairFeature>,
    @InjectRepository(RecommendationGlobalFallbackCandidate)
    private readonly fallbackRepo: Repository<RecommendationGlobalFallbackCandidate>,
    @InjectRepository(RecommendationEmotionProfile)
    private readonly emotionProfileRepo: Repository<RecommendationEmotionProfile>,
  ) {}

  async onModuleInit() {
    try {
      await this.profileEmbeddingRepo.query(
        'CREATE EXTENSION IF NOT EXISTS vector;',
      );
      console.log(
        '[RecommendationStateRepository] pgvector extension verified/created successfully.',
      );
    } catch (err: any) {
      console.error(
        '[RecommendationStateRepository] Failed to ensure pgvector extension is enabled:',
        err.message || err,
      );
    }
  }

  async upsertProfileEmbedding(
    userId: string,
    semanticProfileText: string | null,
    embedding: number[],
    queryEmbedding: number[],
    modelName: string,
    updatedAt: string,
  ): Promise<void> {
    const parsedDate = new Date(updatedAt);
    const vectorLiteral = `[${embedding.join(',')}]`;
    const queryVectorLiteral = `[${queryEmbedding.join(',')}]`;

    // Save using TypeORM upsert or save. We can insert/update embeddingJson & general fields
    const embeddingEntity = this.profileEmbeddingRepo.create({
      userId,
      semanticProfileText,
      embeddingJson: embedding,
      queryEmbeddingJson: queryEmbedding,
      dimensions: embedding.length,
      modelName,
      updatedAt: parsedDate,
    });
    await this.profileEmbeddingRepo.save(embeddingEntity);

    // Cast and set pgvector column via raw SQL UPDATE
    await this.profileEmbeddingRepo.query(
      `UPDATE profile_embeddings
       SET embedding_vector = $1::vector,
           query_embedding_vector = $2::vector
       WHERE user_id = $3`,
      [vectorLiteral, queryVectorLiteral, userId],
    );
  }

  async deleteProfileEmbedding(userId: string): Promise<void> {
    await this.profileEmbeddingRepo.delete({ userId });
  }

  async getProfileEmbedding(userId: string): Promise<any | null> {
    const row = await this.profileEmbeddingRepo.findOneBy({ userId });
    if (!row) return null;
    return {
      userId: row.userId,
      semanticProfileText: row.semanticProfileText,
      embedding: row.embeddingJson || [],
      queryEmbedding: row.queryEmbeddingJson || [],
      dimensions: row.dimensions,
      modelName: row.modelName,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listProfileMetadataForFallback(): Promise<any[]> {
    const rows = await this.profileEmbeddingRepo.find({
      select: ['userId', 'semanticProfileText', 'dimensions', 'updatedAt'],
      where: { dimensions: Not(0) },
    });
    return rows.map((row) => ({
      userId: row.userId,
      semanticProfileText: row.semanticProfileText,
      dimensions: row.dimensions,
      updatedAt: row.updatedAt?.toISOString() || null,
    }));
  }

  async searchSemanticCandidates(
    viewerId: string,
    viewerEmbedding: number[],
    limit: number,
    overscan: number,
  ): Promise<any[]> {
    let embedding = viewerEmbedding;
    if (!embedding || embedding.length === 0) {
      const viewerProfile = await this.getProfileEmbedding(viewerId);
      if (viewerProfile && viewerProfile.embedding) {
        embedding = viewerProfile.embedding;
      }
    }

    if (!embedding || embedding.length === 0) {
      return [];
    }

    const safeLimit = Math.max(1, limit);
    const safeOverscan = Math.max(safeLimit, overscan);
    const vectorLiteral = `[${embedding.join(',')}]`;

    try {
      const rows = await this.profileEmbeddingRepo.query(
        `SELECT
           pe.user_id AS "candidateId",
           pe.semantic_profile_text AS "candidateProfileText",
           pe.embedding_json AS "embeddingJson",
           1 - (pe.embedding_vector::vector <=> $1::vector) AS "retrievalScore"
         FROM profile_embeddings pe
         WHERE pe.user_id <> $2
           AND pe.embedding_vector IS NOT NULL
           AND pe.dimensions = $3
         ORDER BY pe.embedding_vector::vector <=> $1::vector
         LIMIT $4`,
        [vectorLiteral, viewerId, embedding.length, safeOverscan],
      );

      const ranked = rows.map((row: any) => {
        let parsedEmbedding: number[] = [];
        if (row.embeddingJson) {
          if (typeof row.embeddingJson === 'string') {
            try {
              parsedEmbedding = JSON.parse(row.embeddingJson);
            } catch {
              parsedEmbedding = [];
            }
          } else if (Array.isArray(row.embeddingJson)) {
            parsedEmbedding = row.embeddingJson;
          }
        }
        return {
          candidateId: String(row.candidateId),
          candidateProfileText: row.candidateProfileText,
          retrievalScore: Number(row.retrievalScore),
          embedding: parsedEmbedding,
        };
      });

      return this.postFilterSemanticCandidates(viewerId, ranked, safeLimit);
    } catch (err: any) {
      console.error(
        '[RecommendationStateRepository] searchSemanticCandidates SQL query failed:',
        err.message || err,
      );
      // Fallback in case vector database is not available or non-pg environment
      const allProfiles = await this.profileEmbeddingRepo.find();
      const ranked: any[] = [];
      for (const p of allProfiles) {
        if (p.userId === viewerId) continue;
        if (!p.embeddingJson || p.embeddingJson.length !== embedding.length)
          continue;
        // Compute dot product (since vector is normalized)
        let score = 0;
        for (let i = 0; i < embedding.length; i++) {
          score += embedding[i] * p.embeddingJson[i];
        }
        ranked.push({
          candidateId: p.userId,
          candidateProfileText: p.semanticProfileText,
          retrievalScore: score,
          embedding: p.embeddingJson || [],
        });
      }
      ranked.sort((a, b) => b.retrievalScore - a.retrievalScore);
      return this.postFilterSemanticCandidates(
        viewerId,
        ranked.slice(0, safeOverscan),
        safeLimit,
      );
    }
  }

  private async postFilterSemanticCandidates(
    viewerId: string,
    candidates: any[],
    limit: number,
  ): Promise<any[]> {
    if (candidates.length === 0) return [];
    const candidateIds = candidates.map((c) => c.candidateId);
    const excludedIds = await this.getGraphExcludedCandidateIds(
      viewerId,
      candidateIds,
    );

    const filtered = candidates.filter((c) => !excludedIds.has(c.candidateId));
    return filtered.slice(0, limit);
  }

  async getGraphExcludedCandidateIds(
    viewerId: string,
    candidateIds: string[],
  ): Promise<Set<string>> {
    const excluded = new Set<string>();
    excluded.add(viewerId);

    const cleanCandidateIds = candidateIds.filter((id) => id !== viewerId);
    if (cleanCandidateIds.length === 0) return excluded;

    // Friendships
    const friendships = await this.friendshipRepo.find({
      where: [
        { userId: viewerId, friendId: In(cleanCandidateIds) },
        { userId: In(cleanCandidateIds), friendId: viewerId },
      ],
    });
    for (const f of friendships) {
      excluded.add(f.userId === viewerId ? f.friendId : f.userId);
    }

    // Pending requests
    const pending = await this.pendingRequestRepo.find({
      where: [
        { requesterId: viewerId, receiverId: In(cleanCandidateIds) },
        { requesterId: In(cleanCandidateIds), receiverId: viewerId },
      ],
    });
    for (const p of pending) {
      excluded.add(p.requesterId === viewerId ? p.receiverId : p.requesterId);
    }

    // Blocks
    const blocks = await this.blockRepo.find({
      where: [
        { blockerId: viewerId, blockedId: In(cleanCandidateIds) },
        { blockerId: In(cleanCandidateIds), blockedId: viewerId },
      ],
    });
    for (const b of blocks) {
      excluded.add(b.blockerId === viewerId ? b.blockedId : b.blockerId);
    }

    // Dismissals
    const dismissals = await this.dismissalRepo.find({
      where: {
        userId: viewerId,
        candidateId: In(cleanCandidateIds),
      },
    });
    const now = new Date();
    for (const d of dismissals) {
      if (d.expiresAt > now) {
        excluded.add(d.candidateId);
      }
    }

    return excluded;
  }

  async recordGraphEvent(
    eventType: string,
    userId: string,
    targetUserId: string,
    occurredAt: string | Date,
    source: string,
    payload: Record<string, any>,
  ): Promise<void> {
    const event = this.graphEventRepo.create({
      eventType,
      userId,
      targetUserId,
      occurredAt: new Date(occurredAt),
      source: source || 'unknown',
      payloadJson: payload,
      ingestedAt: new Date(),
    });
    await this.graphEventRepo.save(event);
  }

  async applyGraphFriendRequestSent(
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    const now = new Date();
    await this.pendingRequestRepo.save({
      requesterId: userId,
      receiverId: targetUserId,
      updatedAt: now,
    });
  }

  async applyGraphFriendRequestCanceled(
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.pendingRequestRepo.delete({
      requesterId: userId,
      receiverId: targetUserId,
    });
  }

  async applyGraphFriendRequestAccepted(
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    const now = new Date();
    await this.pendingRequestRepo.delete({
      requesterId: targetUserId,
      receiverId: userId,
    });
    await this.friendshipRepo.save([
      { userId, friendId: targetUserId, updatedAt: now },
      { userId: targetUserId, friendId: userId, updatedAt: now },
    ]);
  }

  async applyGraphFriendRequestDeclined(
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.pendingRequestRepo.delete({
      requesterId: targetUserId,
      receiverId: userId,
    });
  }

  async applyGraphFriendshipRemoved(
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.friendshipRepo.delete({ userId, friendId: targetUserId });
    await this.friendshipRepo.delete({
      userId: targetUserId,
      friendId: userId,
    });
  }

  async applyGraphUserBlocked(
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    const now = new Date();
    await this.blockRepo.save({
      blockerId: userId,
      blockedId: targetUserId,
      updatedAt: now,
    });
    await this.friendshipRepo.delete({ userId, friendId: targetUserId });
    await this.friendshipRepo.delete({
      userId: targetUserId,
      friendId: userId,
    });
    await this.pendingRequestRepo.delete({
      requesterId: userId,
      receiverId: targetUserId,
    });
    await this.pendingRequestRepo.delete({
      requesterId: targetUserId,
      receiverId: userId,
    });
  }

  async applyGraphUserUnblocked(
    userId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.blockRepo.delete({ blockerId: userId, blockedId: targetUserId });
  }

  async applyGraphRecommendationDismissed(
    userId: string,
    targetUserId: string,
    expiresAt: Date,
  ): Promise<void> {
    const now = new Date();
    await this.dismissalRepo.save({
      userId,
      candidateId: targetUserId,
      expiresAt,
      updatedAt: now,
    });
  }

  async refreshGraphPairFeaturesForEvent(
    userId: string,
    targetUserId: string,
    eventType: string,
    eventAt: Date,
  ): Promise<void> {
    await this.refreshGraphPairFeature(
      userId,
      targetUserId,
      eventType,
      eventAt,
    );
    await this.refreshGraphPairFeature(
      targetUserId,
      userId,
      eventType,
      eventAt,
    );
  }

  private async refreshGraphPairFeature(
    viewerId: string,
    candidateId: string,
    lastEventType: string,
    lastEventAt: Date,
  ): Promise<void> {
    const hasFriendship = await this.checkFriendshipExists(
      viewerId,
      candidateId,
    );
    const hasPendingRequest = await this.checkPendingRequestExists(
      viewerId,
      candidateId,
    );
    const isBlockedEitherWay = await this.checkBlockedEitherWay(
      viewerId,
      candidateId,
    );
    const hasActiveDismissal = await this.checkActiveDismissal(
      viewerId,
      candidateId,
    );
    const mutualFriendCount = await this.countMutualFriends(
      viewerId,
      candidateId,
    );

    await this.pairFeatureRepo.save({
      viewerId,
      candidateId,
      hasFriendship,
      hasPendingRequest,
      isBlockedEitherWay,
      hasActiveDismissal,
      mutualFriendCount,
      commonGroupCount: 0,
      lastEventType,
      lastEventAt,
      updatedAt: new Date(),
    });
  }

  private async checkFriendshipExists(
    u1: string,
    u2: string,
  ): Promise<boolean> {
    const f = await this.friendshipRepo.findOneBy({ userId: u1, friendId: u2 });
    return !!f;
  }

  private async checkPendingRequestExists(
    u1: string,
    u2: string,
  ): Promise<boolean> {
    const p1 = await this.pendingRequestRepo.findOneBy({
      requesterId: u1,
      receiverId: u2,
    });
    const p2 = await this.pendingRequestRepo.findOneBy({
      requesterId: u2,
      receiverId: u1,
    });
    return !!p1 || !!p2;
  }

  private async checkBlockedEitherWay(
    u1: string,
    u2: string,
  ): Promise<boolean> {
    const b1 = await this.blockRepo.findOneBy({ blockerId: u1, blockedId: u2 });
    const b2 = await this.blockRepo.findOneBy({ blockerId: u2, blockedId: u1 });
    return !!b1 || !!b2;
  }

  private async checkActiveDismissal(u1: string, u2: string): Promise<boolean> {
    const d = await this.dismissalRepo.findOneBy({
      userId: u1,
      candidateId: u2,
    });
    if (!d) return false;
    return d.expiresAt > new Date();
  }

  async getGraphPairFeatures(
    viewerId: string,
    candidateIds: string[],
  ): Promise<Record<string, any>> {
    if (candidateIds.length === 0) return {};
    const rows = await this.pairFeatureRepo.find({
      where: {
        viewerId,
        candidateId: In(candidateIds),
      },
    });

    const features: Record<string, any> = {};
    for (const row of rows) {
      features[row.candidateId] = row;
    }

    const mutualFriendCounts = await this.getMutualFriendCountsBatch(
      viewerId,
      candidateIds,
    );

    for (const candidateId of candidateIds) {
      const mutual = mutualFriendCounts[candidateId] || 0;
      if (features[candidateId]) {
        features[candidateId].mutualFriendCount = mutual;
      } else {
        features[candidateId] = {
          viewerId,
          candidateId,
          hasFriendship: false,
          hasPendingRequest: false,
          isBlockedEitherWay: false,
          hasActiveDismissal: false,
          mutualFriendCount: mutual,
          lastEventType: null,
          lastEventAt: null,
          updatedAt: new Date(),
        };
      }
    }

    return features;
  }

  private async countMutualFriends(u1: string, u2: string): Promise<number> {
    const batch = await this.getMutualFriendCountsBatch(u1, [u2]);
    return batch[u2] || 0;
  }

  private async getMutualFriendCountsBatch(
    viewerId: string,
    candidateIds: string[],
  ): Promise<Record<string, number>> {
    const cleanIds = candidateIds.filter((id) => id !== viewerId);
    if (cleanIds.length === 0) return {};

    // Grouping mutual friends count
    const rows = await this.friendshipRepo.query(
      `SELECT
         cf.user_id AS "candidateId",
         COUNT(DISTINCT vf.friend_id) AS "mutualCount"
       FROM recommendation_friendships vf
       JOIN recommendation_friendships cf ON vf.friend_id = cf.friend_id
       WHERE vf.user_id = $1
         AND cf.user_id = ANY($2)
       GROUP BY cf.user_id`,
      [viewerId, cleanIds],
    );

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[String(row.candidateId)] = Number(row.mutualCount);
    }
    return counts;
  }

  async replaceGlobalFallbackCandidates(
    candidates: any[],
    generatedAt: string | Date,
    scoreVersion = 'global-fallback-v1',
    locale: string | null = null,
    language: string | null = null,
  ): Promise<void> {
    const date = new Date(generatedAt);
    const segmentKey = `${locale || 'global'}::${language || 'global'}`;

    if (candidates.length > 0) {
      for (const c of candidates) {
        await this.fallbackRepo.save({
          segmentKey,
          candidateId: c.candidateId,
          fallbackScore: Number(c.fallbackScore),
          rank: Number(c.rank),
          locale,
          language,
          scoreVersion,
          generatedAt: date,
        });
      }
    }

    // Delete other ranks
    const maxRank = candidates.length;
    await this.fallbackRepo.query(
      `DELETE FROM recommendation_global_fallback_candidates
       WHERE segment_key = $1 AND rank > $2`,
      [segmentKey, maxRank],
    );
  }

  async listGlobalFallbackCandidates(
    offset: number,
    limit: number,
    locale: string | null = null,
    language: string | null = null,
  ): Promise<any[]> {
    const segmentKey = `${locale || 'global'}::${language || 'global'}`;
    const rows = await this.fallbackRepo.find({
      where: { segmentKey },
      order: { rank: 'ASC' },
      skip: Math.max(0, offset),
      take: Math.max(1, limit),
    });

    return rows.map((row) => ({
      candidateId: row.candidateId,
      fallbackScore: row.fallbackScore,
      rank: row.rank,
      locale: row.locale,
      language: row.language,
      scoreVersion: row.scoreVersion,
      generatedAt: row.generatedAt.toISOString(),
    }));
  }

  async getCandidateNegativeSignalCounts(
    candidateIds: string[],
  ): Promise<Record<string, any>> {
    if (candidateIds.length === 0) return {};

    const blocks = await this.blockRepo.query(
      `SELECT blocked_id AS "candidateId", COUNT(*)::int AS "blockCount"
       FROM recommendation_blocks
       WHERE blocked_id = ANY($1)
       GROUP BY blocked_id`,
      [candidateIds],
    );

    const now = new Date();
    const dismissals = await this.dismissalRepo.query(
      `SELECT candidate_id AS "candidateId", COUNT(*)::int AS "dismissalCount"
       FROM recommendation_dismissals
       WHERE candidate_id = ANY($1) AND expires_at > $2
       GROUP BY candidate_id`,
      [candidateIds, now],
    );

    const signals: Record<string, any> = {};
    for (const id of candidateIds) {
      signals[id] = { blockCount: 0, dismissalCount: 0 };
    }

    for (const row of blocks) {
      signals[String(row.candidateId)].blockCount = row.blockCount;
    }

    for (const row of dismissals) {
      signals[String(row.candidateId)].dismissalCount = row.dismissalCount;
    }

    return signals;
  }

  async upsertEmotionProfile(
    userId: string,
    riskScore: number,
    recentNegativityScore: number,
    dominantEmotion: string | null,
    emotionScores: Record<string, number> | null,
    sourceEventAt: string | Date,
  ): Promise<void> {
    const clamp = (val: number) => Math.max(0.0, Math.min(1.0, val));
    const now = new Date();
    const eventAt = new Date(sourceEventAt);

    await this.emotionProfileRepo.save({
      userId,
      riskScore: clamp(riskScore),
      recentNegativityScore: clamp(recentNegativityScore),
      dominantEmotion: dominantEmotion || null,
      emotionScoresJson: emotionScores || {},
      sourceEventAt: eventAt,
      updatedAt: now,
    });
  }

  async getEmotionProfiles(userIds: string[]): Promise<Record<string, any>> {
    if (userIds.length === 0) return {};
    const rows = await this.emotionProfileRepo.find({
      where: { userId: In(userIds) },
    });

    const profiles: Record<string, any> = {};
    for (const row of rows) {
      profiles[row.userId] = {
        userId: row.userId,
        riskScore: row.riskScore,
        recentNegativityScore: row.recentNegativityScore,
        dominantEmotion: row.dominantEmotion,
        emotionScores: row.emotionScoresJson || {},
        sourceEventAt: row.sourceEventAt,
        updatedAt: row.updatedAt,
      };
    }
    return profiles;
  }
}
