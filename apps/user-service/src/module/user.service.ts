import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  RecommendationProfileEmbeddingCompletedPayload,
  RecommendationProfileEmbeddingRequestedPayload,
  SemanticRecommendationCandidateDTO,
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
import { and, eq, inArray, ne } from 'drizzle-orm';
import { USER_STATUS } from 'src/constants';
import { randomUUID } from 'crypto';

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
    private readonly configService: ConfigService,
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
    const user = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          id: dto.id,
          email: dto.email,
        })
        .returning();

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
        stats: { followers: 0, following: 0, posts: 0 },
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
    };

    await this.outboxService.createUserOutboxEvent(
      this.db,
      UserEventType.CREATED,
      payload
    );
    await this.outboxService.createRecommendationProfileEmbeddingRequestedEvent(
      this.db,
      recommendationProfilePayload,
    );

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
    };

    await this.outboxService.createUserOutboxEvent(
      this.db,
      UserEventType.UPDATED,
      payload
    );
    await this.outboxService.createRecommendationProfileEmbeddingRequestedEvent(
      this.db,
      this.buildRecommendationProfileEmbeddingRequestedPayload(
        id,
        finalProfile.semanticProfileText ?? null,
        'user.updated',
      ),
    );

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

    const viewerInterests = this.normalizeInterests(viewer.interests ?? []);
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

  async getSemanticRecommendationCandidates(
    userId: string,
    limit = 20,
  ): Promise<SemanticRecommendationCandidateDTO[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
    const viewer = await this.db
      .select({
        id: users.id,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        bio: profiles.bio,
        location: profiles.location,
        jobTitle: profiles.jobTitle,
        company: profiles.company,
        school: profiles.school,
        interests: profiles.interests,
        semanticProfileText: profiles.semanticProfileText,
        semanticEmbedding: profiles.semanticEmbedding,
      })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(and(eq(users.id, userId), eq(users.status, USER_STATUS.ACTIVE)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!viewer) {
      return [];
    }

    const viewerEmbedding = await this.ensureSemanticEmbeddings([viewer]).then(
      (embeddings) => embeddings[viewer.id],
    );
    if (!viewerEmbedding) {
      return [];
    }

    const pgClient = this.getPgClient();
    const vectorLiteral = this.toVectorLiteral(viewerEmbedding);
    const minScore = this.configService.get<number>(
      'USER_SEMANTIC_RECOMMENDATION_MIN_SCORE',
      0.2,
    );
    const rows = await pgClient.query<{
      id: string;
      semanticMatchScore: number | string;
    }>(
      `
      SELECT
        u.id,
        GREATEST(0, LEAST(1, 1 - (p.semantic_embedding <=> $2::vector)))::float8 AS "semanticMatchScore"
      FROM profiles p
      INNER JOIN users u
        ON u.id = p.user_id
      WHERE u.status = $3
        AND u.id <> $1
        AND p.semantic_embedding IS NOT NULL
      ORDER BY p.semantic_embedding <=> $2::vector ASC, u.id ASC
      LIMIT $4
      `,
      [userId, vectorLiteral, USER_STATUS.ACTIVE, safeLimit],
    );

    const scoredCandidates = rows.rows
      .map((row) => ({
        id: row.id,
        semanticMatchScore: this.clampScore(Number(row.semanticMatchScore)),
      }))
      .filter((candidate) => candidate.semanticMatchScore >= minScore);

    return plainToInstance(SemanticRecommendationCandidateDTO, scoredCandidates, {
      excludeExtraneousValues: true,
    });
  }

  async applyRecommendationProfileEmbedding(
    payload: RecommendationProfileEmbeddingCompletedPayload,
  ): Promise<boolean> {
    const currentProfile = await this.db
      .select({
        semanticProfileText: profiles.semanticProfileText,
      })
      .from(profiles)
      .where(eq(profiles.userId, payload.userId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!currentProfile) {
      this.logger.warn(
        `Ignoring recommendation embedding result for missing userId=${payload.userId}`,
      );
      return false;
    }

    const currentText =
      this.normalizeOptionalText(currentProfile.semanticProfileText) ?? null;
    const incomingText = this.normalizeOptionalText(payload.semanticProfileText) ?? null;

    if (currentText !== incomingText) {
      this.logger.warn(
        `Ignoring stale recommendation embedding result for userId=${payload.userId} requestId=${payload.requestId}`,
      );
      return false;
    }

    await this.db
      .update(profiles)
      .set({
        semanticEmbedding:
          payload.embedding.length > 0 ? payload.embedding : null,
        semanticEmbeddingUpdatedAt:
          payload.embedding.length > 0 ? new Date(payload.generatedAt) : null,
      })
      .where(eq(profiles.userId, payload.userId));

    this.logger.debug(
      `Applied recommendation embedding result for userId=${payload.userId} requestId=${payload.requestId} dimensions=${payload.dimensions}`,
    );

    return true;
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
      firstName: this.normalizeOptionalText(dto.firstName),
      lastName: this.normalizeOptionalText(dto.lastName),
      avatarUrl: this.normalizeOptionalText(dto.avatarUrl),
      bio: this.normalizeOptionalText(dto.bio),
      location: this.normalizeOptionalText(dto.location),
      jobTitle: this.normalizeOptionalText(dto.jobTitle),
      company: this.normalizeOptionalText(dto.company),
      school: this.normalizeOptionalText(dto.school),
      interests:
        dto.interests === undefined
          ? undefined
          : this.normalizeInterests(dto.interests),
    };
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return value ?? null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeInterests(interests: string[] | undefined): string[] {
    if (!Array.isArray(interests)) {
      return [];
    }

    return [...new Set(interests.map((item) => item.trim()).filter(Boolean))].slice(
      0,
      10,
    );
  }

  private buildProfileRecommendationCandidate(
    viewer: {
      id: string;
      location: string | null;
      jobTitle: string | null;
      company: string | null;
      school: string | null;
      interests: string[];
    },
    viewerInterests: string[],
    candidate: {
      id: string;
      location: string | null;
      jobTitle: string | null;
      company: string | null;
      school: string | null;
      interests: string[];
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

    const candidateInterests = this.normalizeInterests(candidate.interests ?? []);
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
    const bio = this.normalizeOptionalText(profile.bio);
    const location = this.normalizeOptionalText(profile.location);
    const school = this.normalizeOptionalText(profile.school);
    const jobTitle = this.normalizeOptionalText(profile.jobTitle);
    const company = this.normalizeOptionalText(profile.company);
    const interests = this.normalizeInterests(profile.interests ?? []);
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
    triggeredBy: 'user.created' | 'user.updated',
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

  private async syncSemanticEmbedding(
    userId: string,
    semanticProfileText: string | null,
  ): Promise<void> {
    const normalizedText = typeof semanticProfileText === 'string'
      ? semanticProfileText.trim()
      : '';
    if (!normalizedText) {
      await this.db
        .update(profiles)
        .set({
          semanticProfileText: null,
          semanticEmbedding: null,
          semanticEmbeddingUpdatedAt: null,
        })
        .where(eq(profiles.userId, userId));
      return;
    }

    try {
      const embeddings = await this.fetchSemanticEmbeddings([
        {
          entityId: userId,
          profileText: normalizedText,
        },
      ]);
      const embedding = embeddings[userId];

      await this.db
        .update(profiles)
        .set({
          semanticProfileText: normalizedText,
          semanticEmbedding: embedding ?? null,
          semanticEmbeddingUpdatedAt: embedding ? new Date() : null,
        })
        .where(eq(profiles.userId, userId));
    } catch (error) {
      this.logger.warn(
        `Failed to sync semantic embedding for userId=${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.db
        .update(profiles)
        .set({
          semanticProfileText: normalizedText,
        })
        .where(eq(profiles.userId, userId));
    }
  }

  private async ensureSemanticEmbeddings(
    profilesToResolve: Array<{
      id: string;
      firstName: string | null;
      lastName: string | null;
      bio: string | null;
      location: string | null;
      jobTitle: string | null;
      company: string | null;
      school: string | null;
      interests: string[] | null;
      semanticProfileText: string | null;
      semanticEmbedding: number[] | null;
    }>,
  ): Promise<Record<string, number[]>> {
    const embeddingsById: Record<string, number[]> = {};
    const pendingEmbeddings: Array<{ entityId: string; profileText: string }> = [];

    for (const profile of profilesToResolve) {
      const existingEmbedding = this.normalizeEmbedding(profile.semanticEmbedding);
      if (existingEmbedding) {
        embeddingsById[profile.id] = existingEmbedding;
        continue;
      }

      const semanticProfileText =
        this.normalizeOptionalText(profile.semanticProfileText) ??
        this.buildSemanticProfileText(profile);
      if (!semanticProfileText) {
        continue;
      }

      pendingEmbeddings.push({
        entityId: profile.id,
        profileText: semanticProfileText,
      });
    }

    if (pendingEmbeddings.length === 0) {
      return embeddingsById;
    }

    let fetchedEmbeddings: Record<string, number[]> = {};
    try {
      fetchedEmbeddings = await this.fetchSemanticEmbeddings(pendingEmbeddings);
    } catch (error) {
      this.logger.warn(
        `Failed to backfill semantic embeddings for ${pendingEmbeddings.length} users: ${error instanceof Error ? error.message : String(error)}`,
      );
      return embeddingsById;
    }
    const writeBacks = pendingEmbeddings.filter(
      (item) => this.normalizeEmbedding(fetchedEmbeddings[item.entityId]) !== null,
    );

    if (writeBacks.length > 0) {
      await Promise.all(
        writeBacks.map((item) =>
          this.db
            .update(profiles)
            .set({
              semanticProfileText: item.profileText,
              semanticEmbedding: fetchedEmbeddings[item.entityId],
              semanticEmbeddingUpdatedAt: new Date(),
            })
            .where(eq(profiles.userId, item.entityId)),
        ),
      );
    }

    for (const [entityId, embedding] of Object.entries(fetchedEmbeddings)) {
      const normalizedEmbedding = this.normalizeEmbedding(embedding);
      if (normalizedEmbedding) {
        embeddingsById[entityId] = normalizedEmbedding;
      }
    }

    return embeddingsById;
  }

  private async fetchSemanticEmbeddings(
    items: Array<{ entityId: string; profileText: string }>,
  ): Promise<Record<string, number[]>> {
    if (items.length === 0) {
      return {};
    }

    const baseUrl = this.configService.get<string>('RECOMMENDATION_SERVICE_URL');
    const internalKey = this.configService.get<string>('RECOMMENDATION_INTERNAL_KEY');

    if (!baseUrl || !internalKey) {
      return {};
    }

    const response = await fetch(`${baseUrl}/recommend/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': internalKey,
      },
      body: JSON.stringify({ items }),
      signal: AbortSignal.timeout(
        this.configService.get<number>('RECOMMENDATION_SERVICE_TIMEOUT_MS', 2000),
      ),
    });

    if (!response.ok) {
      throw new Error(`Recommendation embed failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: {
        embeddings?: Array<{
          entityId?: unknown;
          embedding?: unknown;
        }>;
      };
    };
    const rows = Array.isArray(payload?.data?.embeddings)
      ? payload.data.embeddings
      : [];

    return rows.reduce<Record<string, number[]>>((acc, row) => {
      const entityId = String(row?.entityId ?? '');
      const embedding = this.normalizeEmbedding(row?.embedding);
      if (entityId && embedding) {
        acc[entityId] = embedding;
      }
      return acc;
    }, {});
  }

  private normalizeEmbedding(value: unknown): number[] | null {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }

    const normalized = value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));

    return normalized.length === value.length ? normalized : null;
  }

  private clampScore(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(6))));
  }

  private toVectorLiteral(embedding: number[]): string {
    return `[${embedding.map((value) => Number(value).toFixed(8)).join(',')}]`;
  }

  private getPgClient(): {
    query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  } {
    return (this.db as DrizzleDB & {
      $client: {
        query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
      };
    }).$client;
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
