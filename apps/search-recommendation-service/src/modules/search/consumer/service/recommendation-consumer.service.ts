import { Injectable, Logger } from '@nestjs/common';
import { RecommendationStateRepository } from '../../../recommendation/services/recommendation-state.repository';
import { EmbeddingService } from '../../../recommendation/services/embedding.service';
import { QueryCacheService } from '../../../recommendation/services/query-cache.service';

@Injectable()
export class RecommendationConsumerService {
  private readonly logger = new Logger(RecommendationConsumerService.name);

  constructor(
    private readonly repository: RecommendationStateRepository,
    private readonly embeddingService: EmbeddingService,
    private readonly cacheService: QueryCacheService,
  ) {}

  async handleProfileEmbeddingRequested(payload: any): Promise<void> {
    const userId = String(payload.userId || '').trim();
    const requestId = String(payload.requestId || '').trim();
    const profileText = payload.semanticProfileText;
    const normalizedProfileText =
      typeof profileText === 'string' ? profileText.trim() : null;

    if (!userId || !requestId) {
      this.logger.warn(
        `Skipping invalid profile embedding request: ${JSON.stringify(payload)}`,
      );
      return;
    }

    try {
      if (normalizedProfileText === null) {
        await this.repository.deleteProfileEmbedding(userId);
        await this.cacheService.invalidateViewer(userId);
        this.logger.log(`Profile embedding deleted for user ${userId}`);
        return;
      }

      // Check if unchanged
      const existing = await this.repository.getProfileEmbedding(userId);
      if (
        existing &&
        existing.semanticProfileText === normalizedProfileText &&
        existing.dimensions > 0
      ) {
        this.logger.debug(
          `Skipping unchanged embedding request for user ${userId}`,
        );
        return;
      }

      // Generate Candidate (Passage) Embedding
      const embedding = await this.embeddingService.generateEmbedding(
        this.embeddingService.formatCandidateText(normalizedProfileText),
      );

      // Generate Viewer (Query) Embedding
      const queryEmbedding = await this.embeddingService.generateEmbedding(
        this.embeddingService.formatQueryText(normalizedProfileText),
      );

      const generatedAt = new Date().toISOString();
      await this.repository.upsertProfileEmbedding(
        userId,
        normalizedProfileText,
        embedding,
        queryEmbedding,
        'Xenova/multilingual-e5-base',
        generatedAt,
      );

      await this.cacheService.invalidateViewer(userId);
      this.logger.log(
        `Profile embedding updated for user ${userId}, dim=${embedding.length}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to handle profile embedding for user ${userId}: ${err.message}`,
        err.stack,
      );
    }
  }

  async handleGraphEvent(type: string, payload: any): Promise<void> {
    const userId = String(payload.userId || '').trim();
    const targetUserId = String(payload.targetUserId || '').trim();

    if (!userId || !targetUserId) {
      this.logger.warn(
        `Skipping invalid graph event payload: ${JSON.stringify(payload)}`,
      );
      return;
    }

    const occurredAt = payload.occurredAt
      ? new Date(payload.occurredAt)
      : new Date();
    const source = String(payload.source || '').trim() || 'unknown';

    try {
      await this.repository.recordGraphEvent(
        type,
        userId,
        targetUserId,
        occurredAt,
        source,
        payload,
      );

      if (type === 'recommendation.graph.friend-request-sent') {
        await this.repository.applyGraphFriendRequestSent(userId, targetUserId);
      } else if (type === 'recommendation.graph.friend-request-canceled') {
        await this.repository.applyGraphFriendRequestCanceled(
          userId,
          targetUserId,
        );
      } else if (type === 'recommendation.graph.friend-request-accepted') {
        await this.repository.applyGraphFriendRequestAccepted(
          userId,
          targetUserId,
        );
      } else if (type === 'recommendation.graph.friend-request-declined') {
        await this.repository.applyGraphFriendRequestDeclined(
          userId,
          targetUserId,
        );
      } else if (type === 'recommendation.graph.friendship-removed') {
        await this.repository.applyGraphFriendshipRemoved(userId, targetUserId);
      } else if (type === 'recommendation.graph.user-blocked') {
        await this.repository.applyGraphUserBlocked(userId, targetUserId);
      } else if (type === 'recommendation.graph.user-unblocked') {
        await this.repository.applyGraphUserUnblocked(userId, targetUserId);
      } else if (type === 'recommendation.graph.recommendation-dismissed') {
        const expiresAt = payload.expiresAt
          ? new Date(payload.expiresAt)
          : new Date(Date.now() + 7 * 24 * 3600 * 1000);
        await this.repository.applyGraphRecommendationDismissed(
          userId,
          targetUserId,
          expiresAt,
        );
      }

      await this.repository.refreshGraphPairFeaturesForEvent(
        userId,
        targetUserId,
        type,
        occurredAt,
      );
      await this.cacheService.invalidateMany([userId, targetUserId]);

      this.logger.log(
        `Graph event applied: ${type} between ${userId} and ${targetUserId}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to handle graph event ${type}: ${err.message}`,
        err.stack,
      );
    }
  }

  async handleEmotionEvent(type: string, payload: any): Promise<void> {
    const userId = String(payload.userId || '').trim();
    if (!userId) {
      this.logger.warn(
        `Skipping invalid emotion event payload: ${JSON.stringify(payload)}`,
      );
      return;
    }

    try {
      const riskScore = Number(payload.riskScore) || 0;
      const negativityScore = Number(payload.recentNegativityScore) || 0;
      const dominantEmotion =
        typeof payload.dominantEmotion === 'string'
          ? payload.dominantEmotion.trim()
          : null;
      const emotionScores = payload.finalScores || {};
      const occurredAt = payload.occurredAt
        ? new Date(payload.occurredAt)
        : new Date();

      await this.repository.upsertEmotionProfile(
        userId,
        riskScore,
        negativityScore,
        dominantEmotion,
        emotionScores,
        occurredAt,
      );

      await this.cacheService.invalidateViewer(userId);
      this.logger.log(`Emotion profile updated for user ${userId}`);
    } catch (err) {
      this.logger.error(
        `Failed to handle emotion event: ${err.message}`,
        err.stack,
      );
    }
  }
}
