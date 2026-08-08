import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';

import {
  BaseUserDTO,
  CreateUserDTO,
  EventDestination,
  EventTopic,
  InferUserPayload,
  MediaEventType,
  ProfileRecommendationCandidateDTO,
  RecommendationProfileEmbeddingRequestedPayload,
  UpdateUserDTO,
  UserEventType,
  UserResponseDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { roles, userRoles } from 'src/drizzle/schema/authorize.schema';
import { profiles } from 'src/drizzle/schema/profiles.schema';
import { users } from 'src/drizzle/schema/users.schema';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { OutboxService } from './event/outbox.service';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { USER_STATUS } from 'src/constants';
import { randomUUID } from 'crypto';
import { ProfileHelper } from './helpers/profile.helper';

const CACHE_TTL = {
  USER: 300,
  USERS_LIST: 600,
};

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    @InjectRedis() private redis: Redis,
    private outboxService: OutboxService,
  ) {}

  async create(dto: CreateUserDTO): Promise<UserResponseDTO> {
    const normalizedProfile = this.resolveProfileInput(dto);
    const semanticProfileText = this.buildSemanticProfileText(normalizedProfile);
    const recommendationProfilePayload =
      this.buildRecommendationProfileEmbeddingRequestedPayload(
        dto.id,
        semanticProfileText,
        'user.created',
      );
    let user;
    try {
      user = await this.db.transaction(async (tx) => {
        let [newUser] = await tx
          .insert(users)
          .values({
            id: dto.id,
            email: dto.email,
          })
          .onConflictDoNothing()
          .returning();

        if (!newUser) {
          const [existingUser] = await tx
            .select()
            .from(users)
            .where(eq(users.id, dto.id));
          return existingUser;
        }

        const user = newUser;

        await tx.insert(profiles).values({
          userId: user.id,
          firstName: normalizedProfile.firstName ?? '',
          lastName: normalizedProfile.lastName ?? '',
          avatarUrl: normalizedProfile.avatarUrl ?? null,
          coverImage: null,
          bio: normalizedProfile.bio,
          location: normalizedProfile.location,
          jobTitle: normalizedProfile.jobTitle,
          company: normalizedProfile.company,
          school: normalizedProfile.school,
          interests: normalizedProfile.interests,
          semanticProfileText,
          postCount: 0,
          friendCount: 0,
        });

        const [defaultRole] = await tx
          .select()
          .from(roles)
          .where(eq(roles.name, 'user'));

        let roleId = defaultRole?.id;
        if (!roleId) {
          const [newRole] = await tx
            .insert(roles)
            .values({
              name: 'user',
              description: 'Default user role',
            })
            .returning();
          roleId = newRole.id;
        }

        await tx.insert(userRoles).values({
          userId: user.id,
          roleId,
        });

        return user;
      });
    } catch (error: any) {
      this.logger.error('Database error in createUser:', error);
      if (error.cause) {
        this.logger.error('Error cause:', error.cause);
      }
      throw error;
    }

    await this.redis.del('users:all');

    const payload: InferUserPayload<UserEventType.CREATED> = {
      userId: user.id,
      email: user.email,
      firstName: normalizedProfile.firstName ?? '',
      lastName: normalizedProfile.lastName ?? '',
      avatarUrl: normalizedProfile.avatarUrl ?? undefined,
      bio: normalizedProfile.bio ?? undefined,
      location: normalizedProfile.location ?? undefined,
      jobTitle: normalizedProfile.jobTitle ?? undefined,
      company: normalizedProfile.company ?? undefined,
      school: normalizedProfile.school ?? undefined,
      interests: normalizedProfile.interests ?? undefined,
      isActive: true,
      createdAt: new Date(),
      privacySettings: {
        profileVisibility: 'PUBLIC',
        messagePrivacy: 'EVERYONE',
        friendListVisibility: 'PUBLIC',
      } as any,
    };

    await this.outboxService.createUserOutboxEvent(
      this.db,
      UserEventType.CREATED,
      payload
    );
    if (dto.role !== 'admin') {
      await this.outboxService.createRecommendationProfileEmbeddingRequestedEvent(
        this.db,
        recommendationProfilePayload,
      );
    }

    return plainToInstance(
      UserResponseDTO,
      {
        ...user,
        ...normalizedProfile,
        coverImage: null,
      },
      {
        excludeExtraneousValues: true,
      },
    );
  }

  async findAll(): Promise<UserResponseDTO[]> {
    const cacheKey = 'users:all';
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug('✅ Loaded users from Redis cache');
      return JSON.parse(cached);
    }
    const users = await this.db.query.users.findMany({
      with: {
        profile: {
          columns: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
            coverImage: true,
            bio: true,
            location: true,
            jobTitle: true,
            company: true,
            school: true,
            interests: true,
            privacySettings: true,
            postCount: true,
            friendCount: true,
          },
        },
      },
    });

    const dtos = users.map((user) =>
      plainToInstance(
        UserResponseDTO,
        {
          ...user,
          ...user.profile,
        },
        {
          excludeExtraneousValues: true,
        }
      )
    );
    await this.redis.set(
      cacheKey,
      JSON.stringify(dtos),
      'EX',
      CACHE_TTL.USERS_LIST
    );
    return dtos;
  }

  async findOne(id: string): Promise<UserResponseDTO> {
    const cacheKey = `user:${id}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ Loaded user:${id} from Redis cache`);
      return JSON.parse(cached);
    }
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
      with: {
        profile: {
          columns: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
            coverImage: true,
            bio: true,
            location: true,
            jobTitle: true,
            company: true,
            school: true,
            interests: true,
            privacySettings: true,
            postCount: true,
            friendCount: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const dto = plainToInstance(
      UserResponseDTO,
      { ...user, ...user.profile },
      { excludeExtraneousValues: true }
    );

    await this.redis.set(cacheKey, JSON.stringify(dto), 'EX', CACHE_TTL.USER);
    return dto;
  }

  async findByUsername(username: string): Promise<UserResponseDTO | null> {
    const cachedUser = await this.redis.get(`user:username:${username}`);
    if (cachedUser) {
      return JSON.parse(cachedUser);
    }
    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        isActive: users.isActive,
        createdAt: users.createdAt,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        avatarUrl: profiles.avatarUrl,
        coverImage: profiles.coverImage,
        bio: profiles.bio,
        location: profiles.location,
        jobTitle: profiles.jobTitle,
        company: profiles.company,
        school: profiles.school,
        interests: profiles.interests,
        privacySettings: profiles.privacySettings,
        postCount: profiles.postCount,
        friendCount: profiles.friendCount,
      })
      .from(users)
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(
        and(
          eq(
            sql`LOWER(${profiles.firstName} || ${profiles.lastName})`,
            username.toLowerCase(),
          ),
          eq(users.isActive, true),
        ),
      );

    if (!user) {
      return null;
    }

    const dto = plainToInstance(UserResponseDTO, user, {
      excludeExtraneousValues: true,
    });

    await this.redis.set(
      `user:username:${username}`,
      JSON.stringify(dto),
      'EX',
      CACHE_TTL.USER,
    );
    return dto;
  }

  async incrementPostCount(userId: string) {
    await this.db
      .update(profiles)
      .set({ postCount: sql`${profiles.postCount} + 1` })
      .where(eq(profiles.userId, userId));
    await this.redis.del(`user:${userId}`);
    await this.redis.del('users:all');
  }

  async decrementPostCount(userId: string) {
    await this.db
      .update(profiles)
      .set({ postCount: sql`GREATEST(${profiles.postCount} - 1, 0)` })
      .where(eq(profiles.userId, userId));
    await this.redis.del(`user:${userId}`);
    await this.redis.del('users:all');
  }

  async incrementFriendCount(userIds: string[]) {
    if (!userIds.length) return;
    await this.db
      .update(profiles)
      .set({ friendCount: sql`${profiles.friendCount} + 1` })
      .where(inArray(profiles.userId, userIds));
    for (const userId of userIds) {
      await this.redis.del(`user:${userId}`);
    }
    await this.redis.del('users:all');
  }

  async decrementFriendCount(userIds: string[]) {
    if (!userIds.length) return;
    await this.db
      .update(profiles)
      .set({ friendCount: sql`GREATEST(${profiles.friendCount} - 1, 0)` })
      .where(inArray(profiles.userId, userIds));
    for (const userId of userIds) {
      await this.redis.del(`user:${userId}`);
    }
    await this.redis.del('users:all');
  }

  async update(id: string, dto: UpdateUserDTO) {
    let finalUser: any;
    let finalProfile: any;

    await this.db.transaction(async (tx) => {
      const user = await tx
        .select()
        .from(users)
        .where(eq(users.id, id))
        .then((u) => u[0]);
      if (!user) throw new NotFoundException('User not found');

      if (dto.email && dto.email !== user.email) {
        const existingUser = await tx
          .select()
          .from(users)
          .where(eq(users.email, dto.email))
          .then((u) => u[0]);
        if (existingUser) throw new Error('Email already in use');
      }

      // Update users table
      await tx
        .update(users)
        .set({
          email: dto.email ?? user.email,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id));

      const profile = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.userId, id))
        .then((p) => p[0]);
      if (!profile) throw new NotFoundException('Profile not found');

      const nextProfileInput = this.resolveProfileInput(dto);
      const semanticProfileText = this.buildSemanticProfileText({
        firstName: nextProfileInput.firstName ?? profile.firstName,
        lastName: nextProfileInput.lastName ?? profile.lastName,
        bio: nextProfileInput.bio ?? profile.bio,
        location: nextProfileInput.location ?? profile.location,
        jobTitle: nextProfileInput.jobTitle ?? profile.jobTitle,
        company: nextProfileInput.company ?? profile.company,
        school: nextProfileInput.school ?? profile.school,
        interests: nextProfileInput.interests ?? profile.interests ?? [],
      });
      const updatedProfile = {
        firstName: nextProfileInput.firstName ?? profile.firstName,
        lastName: nextProfileInput.lastName ?? profile.lastName,
        avatarUrl: nextProfileInput.avatarUrl ?? profile.avatarUrl,
        coverImage: dto.coverImage ?? profile.coverImage,
        bio: nextProfileInput.bio ?? profile.bio,
        location: nextProfileInput.location ?? profile.location,
        jobTitle: nextProfileInput.jobTitle ?? profile.jobTitle,
        company: nextProfileInput.company ?? profile.company,
        school: nextProfileInput.school ?? profile.school,
        interests: nextProfileInput.interests ?? profile.interests ?? [],
        semanticProfileText,
        privacySettings: dto.privacySettings 
          ? { ...profile.privacySettings, ...dto.privacySettings } 
          : profile.privacySettings,
        updatedAt: new Date(),
      };

      await tx
        .update(profiles)
        .set(updatedProfile)
        .where(eq(profiles.userId, id));

      if (dto.coverImage?.publicId) {
        await this.outboxService.createOutboxEventWithTransaction(
          tx,
          EventDestination.KAFKA,
          EventTopic.MEDIA,
          MediaEventType.CONTENT_ID_ASSIGNED,
          {
            contentId: id,
            items: [
              {
                publicId: dto.coverImage.publicId,
                url: dto.coverImage.url,
                type: 'image',
              },
            ],
            source: 'user-service',
          }
        );
      }

      if (
        dto.coverImage?.publicId !== undefined &&
        profile.coverImage &&
        typeof profile.coverImage === 'object' &&
        'publicId' in profile.coverImage &&
        (profile.coverImage as any).publicId !== dto.coverImage?.publicId
      ) {
        await this.outboxService.createOutboxEventWithTransaction(
          tx,
          EventDestination.KAFKA,
          EventTopic.MEDIA,
          MediaEventType.DELETE_REQUESTED,
          {
            items: [
              {
                publicId: (profile.coverImage as any).publicId,
                resourceType: 'image',
              },
            ],
            source: 'user-service',
            reason: 'user.cover.updated',
          }
        );
      }

      // Save final state for event payload
      finalUser = {
        id,
        email: dto.email ?? user.email,
      };

      finalProfile = updatedProfile;
    });

    // 🧹 Invalidate cache
    await this.redis.del(`user:${id}`);
    await this.redis.del('users:all');

    // ✅ FULL SNAPSHOT payload
    const payload: InferUserPayload<UserEventType.UPDATED> = {
      userId: id,
      email: finalUser.email,
      firstName: finalProfile.firstName,
      lastName: finalProfile.lastName,
      avatarUrl: finalProfile.avatarUrl ?? undefined,
      bio: finalProfile.bio ?? undefined,
      location: finalProfile.location ?? undefined,
      jobTitle: finalProfile.jobTitle ?? undefined,
      company: finalProfile.company ?? undefined,
      school: finalProfile.school ?? undefined,
      interests: finalProfile.interests ?? undefined,
      privacySettings: finalProfile.privacySettings,
    };

    await this.outboxService.createUserOutboxEvent(
      this.db,
      UserEventType.UPDATED,
      payload
    );
    const userRolesResult = await this.db.select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, id));
    const isAdmin = userRolesResult.some(r => r.name === 'admin');

    if (!isAdmin) {
      await this.outboxService.createRecommendationProfileEmbeddingRequestedEvent(
        this.db,
        this.buildRecommendationProfileEmbeddingRequestedPayload(
          id,
          finalProfile.semanticProfileText ?? null,
          'user.updated',
        ),
      );
    }

    return this.findOne(id);
  }

  async remove(id: string) {
    await this.db.delete(users).where(eq(users.id, id));

    await this.redis.del(`user:${id}`);
    await this.redis.del('users:all');

    const payload: InferUserPayload<UserEventType.REMOVED> = {
      userId: id,
    };
    await this.outboxService.createUserOutboxEvent(
      this.db,
      UserEventType.REMOVED,
      payload
    );
    const userRolesResult = await this.db.select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, id));
    const isAdmin = userRolesResult.some(r => r.name === 'admin');

    if (!isAdmin) {
      await this.outboxService.createRecommendationProfileEmbeddingRequestedEvent(
        this.db,
        this.buildRecommendationProfileEmbeddingRequestedPayload(
          id,
          null,
          'user.removed',
        ),
      );
    }

    return { success: true };
  }

  async getUsersBatch(ids: string[]): Promise<UserResponseDTO[]> {
    if (!ids.length) return [];

    const result = await this.db.query.users.findMany({
      where: and(inArray(users.id, ids), eq(users.status, USER_STATUS.ACTIVE)),
      with: { profile: true },
    });

    return result.map((user) =>
      plainToInstance(
        UserResponseDTO,
        {
          ...user,
          ...user.profile,
        },
        {
          excludeExtraneousValues: true,
        },
      ),
    );
  }

  async getBaseUsersBatch(ids: string[]): Promise<Record<string, BaseUserDTO>> {
    if (!ids.length) return {};

    const rows = await this.db
      .select({
        id: profiles.userId,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        avatarUrl: profiles.avatarUrl,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(
        and(inArray(profiles.userId, ids), eq(users.status, USER_STATUS.ACTIVE))
      );

    const dtos = plainToInstance(BaseUserDTO, rows, {
      excludeExtraneousValues: true,
    });

    const result = dtos.reduce<Record<string, BaseUserDTO>>((acc, u) => {
      acc[u.id] = u;
      return acc;
    }, {});
    return result;
  }

  async searchUserIds(ids: string[], search: string, limit: number = 20): Promise<string[]> {
    if (!ids.length || !search.trim()) return [];

    const searchLower = `%${search.toLowerCase().trim()}%`;

    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(
        and(
          inArray(users.id, ids),
          eq(users.status, USER_STATUS.ACTIVE),
          sql`LOWER(${profiles.firstName} || ' ' || ${profiles.lastName}) LIKE ${searchLower}`
        )
      )
      .limit(limit);

    return rows.map((r) => r.id);
  }



  private resolveProfileInput(
    dto: Partial<CreateUserDTO>,
  ): Partial<{
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    bio: string | null;
    location: string | null;
    jobTitle: string | null;
    company: string | null;
    school: string | null;
    interests: string[];
  }> {
    return {
      firstName: ProfileHelper.normalizeOptionalText(dto.firstName),
      lastName: ProfileHelper.normalizeOptionalText(dto.lastName),
      avatarUrl: ProfileHelper.normalizeOptionalText(dto.avatarUrl),
      bio: ProfileHelper.normalizeOptionalText(dto.bio),
      location: ProfileHelper.normalizeOptionalText(dto.location),
      jobTitle: ProfileHelper.normalizeOptionalText(dto.jobTitle),
      company: ProfileHelper.normalizeOptionalText(dto.company),
      school: ProfileHelper.normalizeOptionalText(dto.school),
      interests:
        dto.interests === undefined
          ? undefined
          : ProfileHelper.normalizeInterests(dto.interests),
    };
  }



  private buildSemanticProfileText(profile: {
    firstName?: string | null;
    lastName?: string | null;
    bio?: string | null;
    location?: string | null;
    jobTitle?: string | null;
    company?: string | null;
    school?: string | null;
    interests?: string[] | null;
  }): string | null {
    const fullName = [profile.firstName, profile.lastName]
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .trim();
    const bio = ProfileHelper.normalizeOptionalText(profile.bio);
    const location = ProfileHelper.normalizeOptionalText(profile.location);
    const school = ProfileHelper.normalizeOptionalText(profile.school);
    const jobTitle = ProfileHelper.normalizeOptionalText(profile.jobTitle);
    const company = ProfileHelper.normalizeOptionalText(profile.company);
    const interests = ProfileHelper.normalizeInterests(profile.interests ?? []);
    const work = [jobTitle, company].filter(Boolean).join(' at ');
    const segments = [
      fullName ? `name: ${fullName}` : '',
      bio ? `bio: ${bio}` : '',
      location ? `location: ${location}` : '',
      work ? `work: ${work}` : '',
      school ? `school: ${school}` : '',
      interests.length > 0 ? `interests: ${interests.join(', ')}` : '',
    ].filter(Boolean);

    return segments.length > 0 ? segments.join('\n') : null;
  }

  private buildRecommendationProfileEmbeddingRequestedPayload(
    userId: string,
    semanticProfileText: string | null,
    triggeredBy: 'user.created' | 'user.updated' | 'user.removed',
  ): RecommendationProfileEmbeddingRequestedPayload {
    return {
      userId,
      semanticProfileText,
      requestId: randomUUID(),
      triggeredBy,
      schemaVersion: 1,
      requestedAt: new Date().toISOString(),
    };
  }

  async getProfileRecommendationCandidates(
    userId: string,
    limit = 20,
  ): Promise<ProfileRecommendationCandidateDTO[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const viewer = await this.db
      .select({
        id: users.id,
        location: profiles.location,
        jobTitle: profiles.jobTitle,
        company: profiles.company,
        school: profiles.school,
        interests: profiles.interests,
      })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(and(eq(users.id, userId), eq(users.status, USER_STATUS.ACTIVE)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!viewer) {
      return [];
    }

    const viewerInterests = ProfileHelper.normalizeInterests(viewer.interests ?? []);
    const hasViewerSignals =
      Boolean(viewer.location) ||
      Boolean(viewer.jobTitle) ||
      Boolean(viewer.company) ||
      Boolean(viewer.school) ||
      viewerInterests.length > 0;

    if (!hasViewerSignals) {
      return [];
    }

    const candidates = await this.db
      .select({
        id: users.id,
        location: profiles.location,
        jobTitle: profiles.jobTitle,
        company: profiles.company,
        school: profiles.school,
        interests: profiles.interests,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(and(eq(users.status, USER_STATUS.ACTIVE), ne(users.id, userId)));

    const scoredCandidates = candidates
      .map((candidate) =>
        this.buildProfileRecommendationCandidate(viewer, viewerInterests, candidate),
      )
      .filter((candidate): candidate is ProfileRecommendationCandidateDTO =>
        Boolean(candidate),
      )
      .sort((left, right) => {
        if (right.profileMatchScore !== left.profileMatchScore) {
          return right.profileMatchScore - left.profileMatchScore;
        }

        if (right.sharedInterestsCount !== left.sharedInterestsCount) {
          return right.sharedInterestsCount - left.sharedInterestsCount;
        }

        return left.id.localeCompare(right.id);
      })
      .slice(0, safeLimit);

    return plainToInstance(ProfileRecommendationCandidateDTO, scoredCandidates, {
      excludeExtraneousValues: true,
    });
  }

  private buildProfileRecommendationCandidate(
    viewer: {
      id: string;
      location: string | null;
      jobTitle: string | null;
      company: string | null;
      school: string | null;
      interests: string[] | null;
    },
    viewerInterests: string[],
    candidate: {
      id: string;
      location: string | null;
      jobTitle: string | null;
      company: string | null;
      school: string | null;
      interests: string[] | null;
      createdAt: Date;
    },
  ): ProfileRecommendationCandidateDTO | null {
    const matchedSignals: string[] = [];
    let score = 0;

    if (this.matchesNormalizedText(viewer.location, candidate.location)) {
      matchedSignals.push('location');
      score += 0.2;
    }

    if (this.matchesNormalizedText(viewer.school, candidate.school)) {
      matchedSignals.push('school');
      score += 0.2;
    }

    if (this.matchesNormalizedText(viewer.company, candidate.company)) {
      matchedSignals.push('company');
      score += 0.2;
    }

    if (this.matchesNormalizedText(viewer.jobTitle, candidate.jobTitle)) {
      matchedSignals.push('jobTitle');
      score += 0.1;
    }

    const candidateInterests = ProfileHelper.normalizeInterests(candidate.interests ?? []);
    const viewerInterestSet = new Set(
      viewerInterests.map((interest) => this.normalizeComparableText(interest)),
    );
    const sharedInterestsCount = candidateInterests.reduce((count, interest) => {
      const normalized = this.normalizeComparableText(interest);
      return count + (viewerInterestSet.has(normalized) ? 1 : 0);
    }, 0);

    if (sharedInterestsCount > 0) {
      matchedSignals.push(`interests:${sharedInterestsCount}`);
      score += Math.min(sharedInterestsCount, 3) * 0.1;
    }

    const profileMatchScore = Number(Math.min(1, score).toFixed(6));
    if (profileMatchScore <= 0) {
      return null;
    }

    return {
      id: candidate.id,
      profileMatchScore,
      matchedSignals,
      sharedInterestsCount,
    };
  }

  private matchesNormalizedText(
    left: string | null | undefined,
    right: string | null | undefined,
  ): boolean {
    const normalizedLeft = this.normalizeComparableText(left);
    const normalizedRight = this.normalizeComparableText(right);
    return Boolean(normalizedLeft) && normalizedLeft === normalizedRight;
  }

  private normalizeComparableText(value: string | null | undefined): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }
}

