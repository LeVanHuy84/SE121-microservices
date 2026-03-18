import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { catchError, lastValueFrom, of, timeout } from 'rxjs';

export interface GroupRecommendationCandidate {
  id: string;
  commonGroups: number;
}

@Injectable()
export class GroupClientService {
  private readonly logger = new Logger(GroupClientService.name);

  constructor(
    @Inject('GROUP_SERVICE') private readonly groupClient: ClientProxy,
  ) {}

  async getCommonGroupCounts(
    userId: string,
    candidateIds: string[],
  ): Promise<Record<string, number>> {
    const dedupedCandidateIds = [...new Set(candidateIds.filter(Boolean))];
    if (!userId || dedupedCandidateIds.length === 0) {
      return {};
    }

    const request$ = this.groupClient
      .send<Record<string, number>>('get_common_group_counts_batch', {
        userId,
        candidateIds: dedupedCandidateIds,
      })
      .pipe(
        timeout(2000),
        catchError((error) => {
          this.logger.error(
            `GROUP_SERVICE recommendation lookup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return of({});
        }),
      );

    const response = await lastValueFrom(request$);

    return dedupedCandidateIds.reduce<Record<string, number>>(
      (acc, candidateId) => {
        const count = response?.[candidateId];
        acc[candidateId] =
          typeof count === 'number' && Number.isFinite(count) ? count : 0;
        return acc;
      },
      {},
    );
  }

  async getGroupRecommendationCandidates(
    userId: string,
    limit: number,
  ): Promise<GroupRecommendationCandidate[]> {
    if (!userId || !Number.isFinite(limit) || limit <= 0) {
      return [];
    }

    const request$ = this.groupClient
      .send<Array<{ id: string; commonGroups: number }>>(
        'get_group_recommendation_candidates',
        {
          userId,
          limit,
        },
      )
      .pipe(
        timeout(2000),
        catchError((error) => {
          this.logger.error(
            `GROUP_SERVICE candidate lookup failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return of([]);
        }),
      );

    const response = await lastValueFrom(request$);

    return (response ?? []).map((candidate) => ({
      id: String(candidate.id),
      commonGroups:
        typeof candidate.commonGroups === 'number' &&
        Number.isFinite(candidate.commonGroups)
          ? candidate.commonGroups
          : 0,
    }));
  }
}
