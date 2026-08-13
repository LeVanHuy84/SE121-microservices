import { Injectable } from '@nestjs/common';
import { RecommendationStateRepository } from './recommendation-state.repository';

@Injectable()
export class GlobalFallbackService {
  constructor(private readonly repository: RecommendationStateRepository) {}

  async getBatch(
    viewerId: string,
    offset: number,
    size: number,
    excludedCandidateIds?: Set<string> | null,
    locale: string | null = null,
    language: string | null = null,
  ): Promise<[any[], boolean]> {
    const safeOffset = Math.max(0, offset);
    const safeSize = Math.max(1, size);
    const excludedIds = new Set<string>(excludedCandidateIds || []);
    excludedIds.add(String(viewerId));

    const targetCount = safeSize + 1;
    let cursor = safeOffset;
    let sourceExhausted = false;
    const filteredCandidates: any[] = [];

    const chunkSize = Math.max(50, safeSize * 5);
    const maxScanRows = Math.max(300, safeSize * 50);
    let scannedRows = 0;

    while (
      filteredCandidates.length < targetCount &&
      scannedRows < maxScanRows
    ) {
      const rows = await this.repository.listGlobalFallbackCandidates(
        cursor,
        chunkSize,
        locale,
        language,
      );
      if (rows.length === 0) {
        sourceExhausted = true;
        break;
      }

      scannedRows += rows.length;
      cursor += rows.length;
      sourceExhausted = rows.length < chunkSize;

      const rawCandidateIds = rows.map((r) => String(r.candidateId));
      const graphExcludedIds =
        await this.repository.getGraphExcludedCandidateIds(
          viewerId,
          rawCandidateIds,
        );

      for (const row of rows) {
        const candidateId = String(row.candidateId);
        if (excludedIds.has(candidateId)) continue;
        if (graphExcludedIds.has(candidateId)) continue;

        filteredCandidates.push({
          candidateId,
          candidateProfileText: null,
          retrievalScore: Number(row.fallbackScore),
          source: 'global_fallback',
        });

        if (filteredCandidates.length >= targetCount) {
          break;
        }
      }

      if (sourceExhausted) {
        break;
      }
    }

    let hasNext = filteredCandidates.length > safeSize;
    if (!hasNext && !sourceExhausted && scannedRows >= maxScanRows) {
      hasNext = true;
    }

    return [filteredCandidates.slice(0, safeSize), hasNext];
  }
}
