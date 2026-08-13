import { Injectable, Logger } from '@nestjs/common';
import { RecommendationStateRepository } from './recommendation-state.repository';
import { CandidateRetrievalService } from './candidate-retrieval.service';
import { GlobalFallbackService } from './global-fallback.service';
import { RankingService } from './ranking.service';
import { QueryCacheService } from './query-cache.service';

const QUERY_SCORE_VERSION = 'recommendation-query-pipeline-v2';
const SESSION_CURSOR_SOURCE = 'semantic_session';

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);
  private readonly sessionWindowSize: number;
  private readonly rerankTopK: number;

  constructor(
    private readonly repository: RecommendationStateRepository,
    private readonly retrievalService: CandidateRetrievalService,
    private readonly fallbackService: GlobalFallbackService,
    private readonly rankingService: RankingService,
    private readonly cacheService: QueryCacheService,
  ) {
    this.sessionWindowSize =
      Number(process.env.RECOMMENDATION_QUERY_SESSION_WINDOW_SIZE) || 200;
    this.rerankTopK =
      Number(process.env.RECOMMENDATION_QUERY_RERANK_TOP_K) || 10;
  }

  async query(request: any): Promise<any> {
    const viewerId = String(request.viewerId || '').trim();
    const generatedAt = new Date().toISOString();

    if (!viewerId) {
      return this.buildOutput(
        viewerId,
        generatedAt,
        'empty',
        QUERY_SCORE_VERSION,
        [],
        false,
        null,
      );
    }

    // Cache Check
    const cachedResponse = await this.cacheService.get(request);
    if (cachedResponse) return cachedResponse;

    const limit = Math.max(1, Number(request.limit) || 20);
    const cursor = this.decodeCursor(request.cursor);
    const cursorSource = String(cursor.source || '').trim();
    const cursorOffset = Math.max(0, Number(cursor.offset) || 0);

    if (cursorSource === SESSION_CURSOR_SOURCE) {
      const sessionResponse = await this.buildSessionResponse(
        request,
        viewerId,
        generatedAt,
        cursor,
        limit,
      );
      if (sessionResponse) return sessionResponse;
    }

    const viewerProfile = await this.repository.getProfileEmbedding(viewerId);
    const viewerProfileText = viewerProfile ? viewerProfile.semanticProfileText : null;
    const viewerQueryEmbedding = viewerProfile ? viewerProfile.queryEmbedding : null;

    const windowSize = this.resolveSessionWindowSize(limit);
    const pageSpan = Math.max(windowSize, this.rerankTopK);

    let primaryBatch: any = null;
    if (cursorSource === '' || cursorSource === 'semantic_online') {
      try {
        primaryBatch = await this.retrievalService.getSemanticOnlineBatch(viewerId, cursorOffset, pageSpan);
      } catch (err) {
        this.logger.warn(`Failed to retrieve semantic online batch: ${err.message}`);
      }
      if (primaryBatch && primaryBatch.candidates.length === 0) {
        primaryBatch = null;
      }
    }

    if (!primaryBatch) {
      return this.buildFallbackOnlyResponse(
        request,
        viewerId,
        generatedAt,
        viewerProfileText,
        cursorOffset,
        limit,
        viewerQueryEmbedding,
      );
    }

    const rankedPrimary = await this.rankingService.rankCandidates(
      viewerId,
      viewerProfileText,
      primaryBatch.candidates,
      viewerQueryEmbedding,
    );

    const sessionCandidates = [...rankedPrimary];
    let responseSource = primaryBatch.source;
    let sessionSource = primaryBatch.source;
    let hasMoreSource = primaryBatch.hasNext;

    if (
      sessionCandidates.length < windowSize &&
      primaryBatch.source === 'semantic_online'
    ) {
      const excludedIds = new Set<string>(
        primaryBatch.candidates.map((c) => String(c.candidateId)),
      );
      const [fallbackCandidates, fallbackHasNext] =
        await this.fallbackService.getBatch(
          viewerId,
          0,
          windowSize - sessionCandidates.length,
          excludedIds,
        );

      const rankedFallback = await this.rankingService.rankCandidates(
        viewerId,
        viewerProfileText,
        fallbackCandidates,
      );

      const normalizedFallback = this.normalizeFallbackCandidates(
        rankedFallback,
        sessionCandidates.length + 1,
      );

      if (normalizedFallback.length > 0) {
        sessionCandidates.push(...normalizedFallback);
        sessionSource = 'hybrid';
        hasMoreSource = hasMoreSource || fallbackHasNext;
      }
    }

    const responseCandidates = sessionCandidates.slice(0, limit);
    if (
      responseCandidates.some((c) => String(c.source) === 'global_fallback')
    ) {
      responseSource = 'hybrid';
    }

    const hasNext = sessionCandidates.length > limit || hasMoreSource;
    const nextCursor = await this.buildNextCursor(
      viewerId,
      sessionSource,
      sessionCandidates,
      responseCandidates.length,
      primaryBatch.source,
      cursorOffset + Math.min(limit, sessionCandidates.length),
      hasNext,
    );

    const response = this.buildOutput(
      viewerId,
      generatedAt,
      responseSource,
      QUERY_SCORE_VERSION,
      responseCandidates,
      hasNext,
      nextCursor,
    );

    return this.cacheService.set(request, response);
  }

  private async buildFallbackOnlyResponse(
    request: any,
    viewerId: string,
    generatedAt: string,
    viewerProfileText: string | null,
    offset: number,
    limit: number,
    viewerQueryEmbedding?: number[] | null,
  ): Promise<any> {
    const [fallbackCandidates, fallbackHasNext] =
      await this.fallbackService.getBatch(viewerId, offset, limit, new Set());

    const ranked = await this.rankingService.rankCandidates(
      viewerId,
      viewerProfileText,
      fallbackCandidates,
      viewerQueryEmbedding,
    );
    const normalized = this.normalizeFallbackCandidates(ranked, 1);

    const hasNext = fallbackHasNext || normalized.length > limit;
    const nextCursor = hasNext
      ? this.encodeCursor('global_fallback', offset + normalized.length)
      : null;

    const response = this.buildOutput(
      viewerId,
      generatedAt,
      'global_fallback',
      QUERY_SCORE_VERSION,
      normalized.slice(0, limit),
      hasNext,
      nextCursor,
    );

    return this.cacheService.set(request, response);
  }

  private normalizeFallbackCandidates(
    candidates: any[],
    startRank: number,
  ): any[] {
    return candidates.map((candidate, index) => {
      const reasonCodes = Array.isArray(candidate.reasonCodes)
        ? [...candidate.reasonCodes]
        : [];
      if (!reasonCodes.includes('global_fallback')) {
        reasonCodes.push('global_fallback');
      }
      return {
        ...candidate,
        source: 'global_fallback',
        rank: startRank + index,
        reasonCodes,
      };
    });
  }

  private async resolveViewerProfileText(
    request: any,
    viewerId: string,
  ): Promise<string | null> {
    if (
      typeof request.viewerProfileText === 'string' &&
      request.viewerProfileText.trim()
    ) {
      return request.viewerProfileText;
    }
    const profile = await this.repository.getProfileEmbedding(viewerId);
    return profile ? profile.semanticProfileText : null;
  }

  private async buildNextCursor(
    viewerId: string,
    sessionSource: string,
    candidates: any[],
    currentPageSize: number,
    fallbackSource: string,
    fallbackOffset: number,
    hasNext: boolean,
  ): Promise<string | null> {
    if (!hasNext) return null;

    if (candidates.length > currentPageSize) {
      const sessionId = await this.cacheService.storeCandidateSession(
        viewerId,
        sessionSource,
        QUERY_SCORE_VERSION,
        candidates,
      );
      if (sessionId) {
        return this.encodeSessionCursor(sessionId, currentPageSize);
      }
    }

    return this.encodeCursor(fallbackSource, fallbackOffset);
  }

  private async buildSessionResponse(
    request: any,
    viewerId: string,
    generatedAt: string,
    cursor: any,
    limit: number,
  ): Promise<any | null> {
    const sessionId = String(cursor.sessionId || '').trim();
    if (!sessionId) return null;

    const session = await this.cacheService.getCandidateSession(sessionId);
    if (!session || String(session.viewerId || '').trim() !== viewerId) {
      return null;
    }

    const candidates = session.candidates;
    if (!Array.isArray(candidates)) return null;

    const offset = Math.max(0, Number(cursor.offset) || 0);
    const selected = candidates.slice(offset, offset + limit);
    const nextOffset = offset + selected.length;
    const hasNext = nextOffset < candidates.length;

    const response = this.buildOutput(
      viewerId,
      generatedAt,
      String(session.source || 'semantic_online'),
      String(session.scoreVersion || QUERY_SCORE_VERSION),
      selected,
      hasNext,
      hasNext ? this.encodeSessionCursor(sessionId, nextOffset) : null,
    );

    return this.cacheService.set(request, response);
  }

  private buildOutput(
    viewerId: string,
    generatedAt: string,
    source: string,
    scoreVersion: string,
    candidates: any[],
    hasNext: boolean,
    nextCursor: string | null,
  ): any {
    return {
      viewerId,
      generatedAt,
      source,
      scoreVersion,
      candidateCount: candidates.length,
      nextCursor,
      hasNextPage: hasNext,
      candidates: candidates.map((c, index) => ({
        candidateId: String(c.candidateId),
        source: String(c.source || source),
        retrievalScore: Number(c.retrievalScore || 0.0),
        modelScore: Number(c.modelScore || 0.0),
        finalScore: Number(c.finalScore || 0.0),
        mutualFriendCount: Number(c.mutualFriendCount || 0),
        commonGroupCount: Number(c.commonGroupCount || 0),
        scoreVersion,
        reasonCodes: Array.isArray(c.reasonCodes) ? c.reasonCodes : [],
        rank: Number(c.rank || index + 1),
      })),
    };
  }

  private resolveSessionWindowSize(limit: number): number {
    const safeLimit = Math.max(1, limit);
    const configuredWindow = Math.max(safeLimit, this.sessionWindowSize);
    const targetWindow = Math.max(safeLimit * 3, this.rerankTopK);
    return Math.min(configuredWindow, targetWindow);
  }

  private decodeCursor(cursor: string | null): any {
    if (!cursor) return {};
    try {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      const payload = JSON.parse(decoded);
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('Invalid cursor payload');
      }

      const source = String(payload.source || '').trim();
      const offset = Number(payload.offset);
      const sessionId = String(payload.sessionId || '').trim();

      if (source === SESSION_CURSOR_SOURCE) {
        if (!sessionId) throw new Error('Missing sessionId');
        return { source: SESSION_CURSOR_SOURCE, sessionId, offset };
      }

      if (source === 'semantic_online' || source === 'global_fallback') {
        return { source, offset };
      }

      throw new Error('Unsupported source');
    } catch {
      throw new Error('Invalid cursor');
    }
  }

  private encodeCursor(source: string, offset: number): string {
    const payload = JSON.stringify({
      source,
      offset: Math.max(0, offset),
    });
    return Buffer.from(payload).toString('base64');
  }

  private encodeSessionCursor(sessionId: string, offset: number): string {
    const payload = JSON.stringify({
      source: SESSION_CURSOR_SOURCE,
      sessionId,
      offset: Math.max(0, offset),
    });
    return Buffer.from(payload).toString('base64');
  }
}
