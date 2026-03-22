import { InjectRedis } from '@nestjs-modules/ioredis';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import Redis from 'ioredis';
import { catchError, lastValueFrom, of, timeout } from 'rxjs';

export interface GroupRecommendationCandidate {
  id: string;
  commonGroups: number;
}

@Injectable()
export class GroupClientService {
  private readonly logger = new Logger(GroupClientService.name);
  private readonly commonGroupCacheTtlSeconds = 60 * 5;

  constructor(
    @InjectRedis() private readonly redis: Redis,
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

    return this.resolvePerCandidateCache<number>({
      userId,
      candidateIds: dedupedCandidateIds,
      metricLabel: 'common group counts',
      cacheKeyFactory: (candidateId) =>
        this.getGroupCacheKey(userId, candidateId, 'common-groups-count'),
      decodeCachedValue: (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      },
      encodeCachedValue: (value) => String(value),
      normalizeFetchedValue: (value) =>
        typeof value === 'number' && Number.isFinite(value) ? value : 0,
      fetchUncached: async (uncachedCandidateIds) => {
        const response = await this.sendGroupRequest<Record<string, number>>(
          'get_common_group_counts_batch',
          {
            userId,
            candidateIds: uncachedCandidateIds,
          },
          {},
        );

        return uncachedCandidateIds.reduce<Record<string, number>>(
          (acc, candidateId) => {
            acc[candidateId] = response?.[candidateId] ?? 0;
            return acc;
          },
          {},
        );
      },
      defaultValue: 0,
    });
  }

  async getCommonGroupNames(
    userId: string,
    candidateIds: string[],
    limitPerCandidate = 3,
  ): Promise<Record<string, string[]>> {
    const dedupedCandidateIds = [...new Set(candidateIds.filter(Boolean))];
    if (!userId || dedupedCandidateIds.length === 0) {
      return {};
    }

    const safeLimit = Math.max(1, Math.floor(limitPerCandidate));

    return this.resolvePerCandidateCache<string[]>({
      userId,
      candidateIds: dedupedCandidateIds,
      metricLabel: 'common group names',
      cacheKeyFactory: (candidateId) =>
        this.getGroupCacheKey(
          userId,
          candidateId,
          `common-groups-names:${safeLimit}`,
        ),
      decodeCachedValue: (value) => {
        try {
          const parsed = JSON.parse(value) as unknown;
          return this.normalizeGroupNames(parsed, safeLimit);
        } catch {
          return null;
        }
      },
      encodeCachedValue: (value) => JSON.stringify(value),
      normalizeFetchedValue: (value) => this.normalizeGroupNames(value, safeLimit),
      fetchUncached: async (uncachedCandidateIds) => {
        const response = await this.sendGroupRequest<Record<string, string[]>>(
          'get_common_group_names_batch',
          {
            userId,
            candidateIds: uncachedCandidateIds,
            limitPerCandidate: safeLimit,
          },
          {},
        );

        return uncachedCandidateIds.reduce<Record<string, string[]>>(
          (acc, candidateId) => {
            acc[candidateId] = this.normalizeGroupNames(
              response?.[candidateId],
              safeLimit,
            );
            return acc;
          },
          {},
        );
      },
      defaultValue: [],
      extraLogData: `limitPerCandidate=${safeLimit}`,
    });
  }

  async getGroupRecommendationCandidates(
    userId: string,
    limit: number,
  ): Promise<GroupRecommendationCandidate[]> {
    if (!userId || !Number.isFinite(limit) || limit <= 0) {
      return [];
    }

    const startedAt = Date.now();
    const response = await this.sendGroupRequest<
      Array<{ id: string; commonGroups: number }>
    >(
      'get_group_recommendation_candidates',
      {
        userId,
        limit,
      },
      [],
    );

    const candidates = (response ?? []).map((candidate) => ({
      id: String(candidate.id),
      commonGroups:
        typeof candidate.commonGroups === 'number' &&
        Number.isFinite(candidate.commonGroups)
          ? candidate.commonGroups
          : 0,
    }));

    this.logger.debug(
      `GROUP_SERVICE recommendation candidates resolved: requestedLimit=${limit} returned=${candidates.length} durationMs=${Date.now() - startedAt}`,
    );

    return candidates;
  }

  private async resolvePerCandidateCache<T>(options: {
    userId: string;
    candidateIds: string[];
    metricLabel: string;
    cacheKeyFactory: (candidateId: string) => string;
    decodeCachedValue: (value: string) => T | null;
    encodeCachedValue: (value: T) => string;
    normalizeFetchedValue: (value: unknown) => T;
    fetchUncached: (candidateIds: string[]) => Promise<Record<string, unknown>>;
    defaultValue: T;
    extraLogData?: string;
  }): Promise<Record<string, T>> {
    const startedAt = Date.now();
    const valuesByCandidate: Record<string, T> = {};
    const uncachedCandidateIds: string[] = [];
    const pipeline = this.redis.pipeline();

    options.candidateIds.forEach((candidateId) =>
      pipeline.get(options.cacheKeyFactory(candidateId)),
    );
    const cachedResults = await pipeline.exec();

    if (cachedResults) {
      cachedResults.forEach(([, value], index) => {
        const candidateId = options.candidateIds[index];
        if (typeof value !== 'string') {
          uncachedCandidateIds.push(candidateId);
          return;
        }

        const decodedValue = options.decodeCachedValue(value);
        if (decodedValue === null) {
          uncachedCandidateIds.push(candidateId);
          return;
        }

        valuesByCandidate[candidateId] = decodedValue;
      });
    } else {
      uncachedCandidateIds.push(...options.candidateIds);
    }

    if (uncachedCandidateIds.length > 0) {
      const fetchedValues = await options.fetchUncached(uncachedCandidateIds);
      const writePipeline = this.redis.pipeline();

      for (const candidateId of uncachedCandidateIds) {
        const normalizedValue = options.normalizeFetchedValue(
          fetchedValues?.[candidateId],
        );
        valuesByCandidate[candidateId] = normalizedValue;
        writePipeline.set(
          options.cacheKeyFactory(candidateId),
          options.encodeCachedValue(normalizedValue),
          'EX',
          this.commonGroupCacheTtlSeconds,
        );
      }

      await writePipeline.exec();
    }

    this.logger.debug(
      `GROUP_SERVICE ${options.metricLabel} resolved: requested=${options.candidateIds.length} cacheHits=${options.candidateIds.length - uncachedCandidateIds.length} cacheMisses=${uncachedCandidateIds.length}${options.extraLogData ? ` ${options.extraLogData}` : ''} durationMs=${Date.now() - startedAt}`,
    );

    return options.candidateIds.reduce<Record<string, T>>((acc, candidateId) => {
      acc[candidateId] = valuesByCandidate[candidateId] ?? options.defaultValue;
      return acc;
    }, {});
  }

  private async sendGroupRequest<T>(
    pattern: string,
    payload: Record<string, unknown>,
    fallbackValue: T,
  ): Promise<T> {
    const request$ = this.groupClient.send<T>(pattern, payload).pipe(
      timeout(2000),
      catchError((error) => {
        this.logger.error(
          `GROUP_SERVICE ${pattern} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return of(fallbackValue);
      }),
    );

    return lastValueFrom(request$);
  }

  private normalizeGroupNames(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(
        (name): name is string =>
          typeof name === 'string' && name.trim().length > 0,
      )
      .slice(0, limit);
  }

  private getGroupCacheKey(
    userId: string,
    candidateId: string,
    field: string,
  ): string {
    return `group:${userId}:${candidateId}:${field}`;
  }
}
