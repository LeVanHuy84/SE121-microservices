import { Injectable, Logger } from '@nestjs/common';
import { RecommendationStateRepository } from './recommendation-state.repository';
import { EmbeddingService } from './embedding.service';

@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);
  private readonly modelWeight: number;
  private readonly retrievalWeight: number;
  private readonly graphWeight: number;
  private readonly emotionWeight: number;
  private readonly emotionScoringEnabled: boolean;
  private readonly rerankTopK: number;
  private readonly rerankTopKCpu: number;
  private readonly scoreFloor: number;
  private readonly scoreCeiling: number;
  private readonly mutualFriendCap: number;
  private readonly maxCandidates: number;
  private readonly emotionMaxAgeHours: number;

  constructor(
    private readonly repository: RecommendationStateRepository,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.modelWeight =
      Number(process.env.RECOMMENDATION_QUERY_MODEL_WEIGHT) || 0.56;
    this.retrievalWeight =
      Number(process.env.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT) || 0.24;
    this.graphWeight =
      Number(process.env.RECOMMENDATION_QUERY_GRAPH_WEIGHT) || 0.12;
    this.emotionWeight =
      Number(process.env.RECOMMENDATION_QUERY_EMOTION_WEIGHT) || 0.08;
    this.emotionScoringEnabled =
      process.env.RECOMMENDATION_EMOTION_SCORING_ENABLED !== 'false';
    this.rerankTopK =
      Number(process.env.RECOMMENDATION_QUERY_RERANK_TOP_K) || 10;
    this.rerankTopKCpu =
      Number(process.env.RECOMMENDATION_QUERY_RERANK_TOP_K_CPU) || 4;
    this.scoreFloor = Number(process.env.RECOMMENDATION_SCORE_FLOOR) || 0.55;
    this.scoreCeiling = Number(process.env.RECOMMENDATION_SCORE_CEILING) || 0.9;
    this.mutualFriendCap =
      Number(process.env.RECOMMENDATION_MUTUAL_FRIEND_CAP) || 10;
    this.maxCandidates =
      Number(process.env.RECOMMENDATION_MAX_CANDIDATES) || 30;
    this.emotionMaxAgeHours =
      Number(process.env.RECOMMENDATION_EMOTION_DATA_MAX_AGE_HOURS) || 168;
  }

  async rankCandidates(
    viewerId: string,
    viewerProfileText: string | null,
    candidates: any[],
    viewerQueryEmbedding?: number[] | null,
  ): Promise<any[]> {
    if (candidates.length === 0) return [];

    const deduped = this.dedupeCandidates(candidates);
    if (deduped.length === 0) return [];

    const topK = this.resolveRerankTopK();
    const enrichK = Math.max(topK, 25);

    // Sort by retrieval score descending before selecting top_k
    deduped.sort((a, b) => {
      const diff =
        Number(b.retrievalScore || 0) - Number(a.retrievalScore || 0);
      if (diff !== 0) return diff;
      return String(a.candidateId).localeCompare(String(b.candidateId));
    });

    const enrichCandidates = deduped.slice(0, enrichK);
    const enrichIds = enrichCandidates.map((c) => String(c.candidateId));

    const pairFeatures = await this.repository.getGraphPairFeatures(
      viewerId,
      enrichIds,
    );

    let emotionProfiles: Record<string, any> = {};
    if (this.emotionScoringEnabled) {
      emotionProfiles = await this.repository.getEmotionProfiles([
        viewerId,
        ...enrichIds,
      ]);
    }

    const viewerEmotion = emotionProfiles[viewerId];

    const rerankInput = enrichCandidates.slice(0, topK);
    const modelScores = await this.resolveModelScores(
      viewerProfileText,
      rerankInput,
      viewerQueryEmbedding,
    );

    const scored: any[] = [];
    for (const candidate of deduped) {
      const candidateId = String(candidate.candidateId);
      const pairFeature = pairFeatures[candidateId];

      const modelScore = Number(modelScores[candidateId] || 0.0);
      const retrievalScore = Number(candidate.retrievalScore || 0.0);
      const graphScore = pairFeature
        ? this.calculateGraphScore(pairFeature)
        : 0.0;
      const emotionScore =
        viewerEmotion && emotionProfiles[candidateId]
          ? this.calculateEmotionAffinity(
              viewerEmotion,
              emotionProfiles[candidateId],
            )
          : 0.0;

      scored.push({
        ...candidate,
        modelScore,
        emotionScore,
        mutualFriendCount: pairFeature ? pairFeature.mutualFriendCount : 0,
        commonGroupCount: 0,
        finalScore: this.resolveFinalScore(
          retrievalScore,
          modelScore,
          graphScore,
          emotionScore,
        ),
        reasonCodes: this.buildReasonCodes(
          modelScore,
          pairFeature,
          emotionScore,
        ),
      });
    }

    scored.sort((a, b) => {
      const diffFinal = b.finalScore - a.finalScore;
      if (diffFinal !== 0) return diffFinal;
      const diffModel = b.modelScore - a.modelScore;
      if (diffModel !== 0) return diffModel;
      const diffRetrieval = b.retrievalScore - a.retrievalScore;
      if (diffRetrieval !== 0) return diffRetrieval;
      return String(a.candidateId).localeCompare(String(b.candidateId));
    });

    return scored.map((c, index) => ({
      ...c,
      rank: index + 1,
    }));
  }

  private dedupeCandidates(candidates: any[]): any[] {
    const deduped: any[] = [];
    const seen = new Set<string>();
    for (const c of candidates) {
      const id = String(c.candidateId || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      deduped.push(c);
    }
    return deduped;
  }

  private async resolveModelScores(
    viewerProfileText: string | null,
    candidates: any[],
    viewerQueryEmbedding?: number[] | null,
  ): Promise<Record<string, number>> {
    if (
      !viewerProfileText ||
      candidates.length === 0 ||
      !this.embeddingService.isReady()
    ) {
      return {};
    }

    const start = Date.now();
    let dynamicGenCount = 0;
    const scores: Record<string, number> = {};
    try {
      let queryVector = viewerQueryEmbedding;
      if (!queryVector || queryVector.length === 0) {
        dynamicGenCount++;
        queryVector = await this.embeddingService.generateEmbedding(
          this.embeddingService.formatQueryText(viewerProfileText),
        );
      }

      for (const candidate of candidates.slice(0, this.maxCandidates)) {
        const text = candidate.candidateProfileText;
        if (!text) {
          scores[candidate.candidateId] = 0.0;
          continue;
        }

        let candidateVector = candidate.embedding;
        if (!candidateVector || candidateVector.length === 0) {
          dynamicGenCount++;
          candidateVector = await this.embeddingService.generateEmbedding(
            this.embeddingService.formatCandidateText(text),
          );
        }

        // Dot product / Cosine Similarity
        let similarity = 0;
        for (let i = 0; i < queryVector.length; i++) {
          similarity += queryVector[i] * candidateVector[i];
        }

        // Calibration
        let calibrated = similarity;
        if (this.scoreCeiling > this.scoreFloor) {
          calibrated =
            (similarity - this.scoreFloor) /
            (this.scoreCeiling - this.scoreFloor);
        } else {
          calibrated = (similarity + 1.0) / 2.0;
        }

        scores[candidate.candidateId] = Math.max(
          0.0,
          Math.min(1.0, calibrated),
        );
      }
    } catch (err: any) {
      this.logger.error(`Model rerank inference failed: ${err.message}`);
    }

    this.logger.log(
      `resolveModelScores took ${Date.now() - start}ms. Dynamic embedding generations: ${dynamicGenCount}/${candidates.length}`,
    );
    return scores;
  }

  private calculateGraphScore(pairFeature: any): number {
    const cap = Math.max(1, this.mutualFriendCap);
    const mutualFriendScore =
      Math.min(pairFeature.mutualFriendCount, cap) / cap;

    let recentEventScore = 0.0;
    const lastEventType = pairFeature.lastEventType || '';
    if (
      lastEventType === 'recommendation.graph.user-unblocked' ||
      lastEventType === 'recommendation.graph.friend-request-canceled'
    ) {
      recentEventScore = 0.1;
    }

    return Math.max(
      0.0,
      Math.min(1.0, 0.7 * mutualFriendScore + recentEventScore),
    );
  }

  private calculateEmotionAffinity(viewer: any, candidate: any): number {
    if (this.isEmotionStale(viewer) || this.isEmotionStale(candidate)) {
      return 0.0;
    }

    const viewerNeg = Math.max(
      0,
      Math.min(1, viewer.recentNegativityScore || 0),
    );
    const candNeg = Math.max(
      0,
      Math.min(1, candidate.recentNegativityScore || 0),
    );
    const viewerRisk = Math.max(0, Math.min(1, viewer.riskScore || 0));
    const candRisk = Math.max(0, Math.min(1, candidate.riskScore || 0));

    const stabilityComplementarity = 1.0 - (viewerNeg + candNeg) / 2.0;
    const riskPenalty =
      Math.max(0.0, (viewerRisk + candRisk) / 2.0 - 0.7) * 0.5;

    const baseScore = 0.75 * stabilityComplementarity + 0.25 * (1.0 - candRisk);

    return Math.max(0.0, Math.min(1.0, baseScore - riskPenalty));
  }

  private isEmotionStale(profile: any): boolean {
    if (!profile || !profile.updatedAt) return true;
    const ageMs = Date.now() - new Date(profile.updatedAt).getTime();
    return ageMs > this.emotionMaxAgeHours * 3600 * 1000;
  }

  private resolveFinalScore(
    retrievalScore: number,
    modelScore: number,
    graphScore: number,
    emotionScore: number,
  ): number {
    const raw =
      this.modelWeight * modelScore +
      this.retrievalWeight * retrievalScore +
      this.graphWeight * graphScore +
      this.emotionWeight * emotionScore;
    return Math.round(raw * 1000000) / 1000000;
  }

  private buildReasonCodes(
    modelScore: number,
    pairFeature: any,
    emotionScore: number,
  ): string[] {
    const reasons = ['semantic_retrieval'];
    if (modelScore > 0) {
      reasons.push('semantic_rerank');
    }
    if (emotionScore > 0) {
      reasons.push('emotion_affinity');
    }

    if (pairFeature) {
      if (pairFeature.mutualFriendCount > 0) {
        reasons.push('graph_mutual_friend');
      }
      if (this.calculateGraphScore(pairFeature) > 0) {
        reasons.push('graph_rerank');
      }
      const lastEventType = pairFeature.lastEventType || '';
      if (lastEventType === 'recommendation.graph.user-unblocked') {
        reasons.push('graph_recent_unblock');
      } else if (
        lastEventType === 'recommendation.graph.friend-request-canceled'
      ) {
        reasons.push('graph_recent_request_canceled');
      } else if (lastEventType === 'recommendation.graph.friendship-removed') {
        reasons.push('graph_recent_friendship_removed');
      }
    }

    return reasons;
  }

  private resolveRerankTopK(): number {
    // We default to the CPU top K logic to ensure stability in non-GPU environments
    return Math.max(0, Math.min(this.rerankTopK, this.rerankTopKCpu));
  }
}
