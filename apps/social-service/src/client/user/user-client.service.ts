import { InjectRedis } from '@nestjs-modules/ioredis';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  BaseUserDTO,
  UserResponseDTO
} from '@repo/dtos';
import Redis from 'ioredis';
import { catchError, lastValueFrom, of, timeout } from 'rxjs';

type UserProjection = 'base' | 'full';

type UserProjection = 'base' | 'full';

@Injectable()
export class UserClientService {
  private readonly baseProfileCacheTtlSeconds = 60 * 5;
  private readonly fullProfileCacheTtlSeconds = 60 * 5;
  private readonly logger = new Logger(UserClientService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy,
  ) {}

  async getUsers(
    userIds: string[],
    projection: 'base',
  ): Promise<Record<string, BaseUserDTO>>;
  async getUsers(
    userIds: string[],
    projection: 'full',
  ): Promise<Record<string, UserResponseDTO>>;
  async getUsers(
    userIds: string[],
    projection: UserProjection,
  ): Promise<Record<string, BaseUserDTO | UserResponseDTO>> {
    const dedupedIds = [...new Set(userIds.filter(Boolean))];
    if (dedupedIds.length === 0) {
      return {};
    }

    const startedAt = Date.now();
    const cachedUsers =
      projection === 'base'
        ? await this.getCachedBaseUsers(dedupedIds)
        : await this.getCachedFullUsers(dedupedIds);
    const unresolvedIds = dedupedIds.filter((userId) => !cachedUsers[userId]);

    let fetchedUsers: Record<string, BaseUserDTO | UserResponseDTO> = {};
    if (unresolvedIds.length > 0) {
      fetchedUsers =
        projection === 'base'
          ? await this.fetchBaseUsers(unresolvedIds)
          : await this.fetchFullUsers(unresolvedIds);
    }

    const usersById = dedupedIds.reduce<
      Record<string, BaseUserDTO | UserResponseDTO>
    >((acc, userId) => {
      const user = cachedUsers[userId] ?? fetchedUsers[userId];
      if (user) {
        acc[userId] = user;
      }
      return acc;
    }, {});

    this.logger.debug(
      `USER_SERVICE users resolved: projection=${projection} requested=${dedupedIds.length} cacheHits=${dedupedIds.length - unresolvedIds.length} cacheMisses=${unresolvedIds.length} durationMs=${Date.now() - startedAt}`,
    );

    return usersById;
  }

  async searchUserIds(ids: string[], search: string, limit?: number): Promise<string[]> {
    if (!ids.length || !search.trim()) return [];
    const matchedIds = await lastValueFrom(
      this.userClient.send<string[]>('searchUserIds', { ids, search, limit }).pipe(
        timeout(3000),
        catchError((error) => {
          this.logger.error(`searchUserIds timeout/error: ${error?.message || error}`);
          return of([]);
        })
      ),
    );
    return Array.isArray(matchedIds) ? matchedIds : [];
  }



  private async getCachedBaseUsers(
    userIds: string[],
  ): Promise<Record<string, BaseUserDTO>> {
    const profilesById: Record<string, BaseUserDTO> = {};
    const basePipeline = this.redis.pipeline();
    userIds.forEach((id) =>
      basePipeline.hgetall(this.getUserCacheKey(id, 'base')),
    );
    const baseResults = await basePipeline.exec();

    const idsMissingBaseCache: string[] = [];
    if (baseResults) {
      baseResults.forEach(([error, data], index) => {
        const userId = userIds[index];
        const hash = data as Record<string, string>;

        if (error || !hash || Object.keys(hash).length === 0) {
          idsMissingBaseCache.push(userId);
          return;
        }

        profilesById[userId] = {
          id: userId,
          firstName: hash.firstName ?? '',
          lastName: hash.lastName ?? '',
          avatarUrl: hash.avatarUrl ?? '',
        };
      });
    } else {
      idsMissingBaseCache.push(...userIds);
    }

    if (idsMissingBaseCache.length === 0) {
      return profilesById;
    }

    const fullPipeline = this.redis.pipeline();
    idsMissingBaseCache.forEach((id) =>
      fullPipeline.get(this.getUserCacheKey(id, 'full')),
    );
    const fullResults = await fullPipeline.exec();

    if (!fullResults) {
      return profilesById;
    }

    const writePipeline = this.redis.pipeline();
    fullResults.forEach(([, value], index) => {
      const userId = idsMissingBaseCache[index];
      if (typeof value !== 'string') {
        return;
      }

      try {
        const profile = JSON.parse(value) as UserResponseDTO;
        const baseProfile = this.toBaseUserDTO(profile);
        profilesById[userId] = baseProfile;
        writePipeline.hmset(this.getUserCacheKey(userId, 'base'), {
          firstName: baseProfile.firstName ?? '',
          lastName: baseProfile.lastName ?? '',
          avatarUrl: baseProfile.avatarUrl ?? '',
        });
        writePipeline.expire(
          this.getUserCacheKey(userId, 'base'),
          this.baseProfileCacheTtlSeconds,
        );
      } catch {
        return;
      }
    });

    await writePipeline.exec();
    return profilesById;
  }

  private async getCachedFullUsers(
    userIds: string[],
  ): Promise<Record<string, UserResponseDTO>> {
    const profilesById: Record<string, UserResponseDTO> = {};
    const pipeline = this.redis.pipeline();
    userIds.forEach((id) => pipeline.get(this.getUserCacheKey(id, 'full')));
    const cachedResults = await pipeline.exec();

    if (!cachedResults) {
      return profilesById;
    }

    cachedResults.forEach(([, value], index) => {
      const userId = userIds[index];
      if (typeof value !== 'string') {
        return;
      }

      try {
        profilesById[userId] = JSON.parse(value) as UserResponseDTO;
      } catch {
        return;
      }
    });

    return profilesById;
  }

  private async fetchBaseUsers(
    userIds: string[],
  ): Promise<Record<string, BaseUserDTO>> {
    const fetchedProfiles: Record<string, BaseUserDTO> = await lastValueFrom(
      this.userClient.send<Record<string, BaseUserDTO>>(
        'getBaseUsersBatch',
        userIds,
      ).pipe(
        timeout(3000),
        catchError((error) => {
          this.logger.error(`fetchBaseUsers timeout/error: ${error?.message || error}`);
          return of({});
        })
      )
    );
    const writePipeline = this.redis.pipeline();

    for (const [id, profile] of Object.entries(fetchedProfiles ?? {})) {
      writePipeline.hmset(this.getUserCacheKey(id, 'base'), {
        firstName: profile.firstName ?? '',
        lastName: profile.lastName ?? '',
        avatarUrl: profile.avatarUrl ?? '',
      });
      writePipeline.expire(
        this.getUserCacheKey(id, 'base'),
        this.baseProfileCacheTtlSeconds,
      );
    }

    await writePipeline.exec();
    return fetchedProfiles;
  }

  private async fetchFullUsers(
    userIds: string[],
  ): Promise<Record<string, UserResponseDTO>> {
    const profiles = await lastValueFrom(
      this.userClient.send<UserResponseDTO[]>('getUsersBatch', userIds).pipe(
        timeout(3000),
        catchError((error) => {
          this.logger.error(`fetchFullUsers timeout/error: ${error?.message || error}`);
          return of([]);
        })
      )
    );
    const profilesById: Record<string, UserResponseDTO> = {};
    const fullWritePipeline = this.redis.pipeline();
    const baseWritePipeline = this.redis.pipeline();

    for (const profile of profiles ?? []) {
      if (!profile?.id) {
        continue;
      }

      profilesById[profile.id] = profile;
      fullWritePipeline.set(
        this.getUserCacheKey(profile.id, 'full'),
        JSON.stringify(profile),
        'EX',
        this.fullProfileCacheTtlSeconds,
      );

      const baseProfile = this.toBaseUserDTO(profile);
      baseWritePipeline.hmset(this.getUserCacheKey(profile.id, 'base'), {
        firstName: baseProfile.firstName ?? '',
        lastName: baseProfile.lastName ?? '',
        avatarUrl: baseProfile.avatarUrl ?? '',
      });
      baseWritePipeline.expire(
        this.getUserCacheKey(profile.id, 'base'),
        this.baseProfileCacheTtlSeconds,
      );
    }

    await Promise.all([fullWritePipeline.exec(), baseWritePipeline.exec()]);
    return profilesById;
  }

  private toBaseUserDTO(profile: UserResponseDTO): BaseUserDTO {
    return {
      id: profile.id,
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      avatarUrl: profile.avatarUrl ?? '',
    };
  }

  private getUserCacheKey(userId: string, projection: UserProjection): string {
    return `user:${userId}:${projection}`;
  }
}
