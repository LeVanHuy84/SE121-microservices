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
import { and, eq, inArray } from 'drizzle-orm';
import { USER_STATUS } from 'src/constants';

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
    private outboxService: OutboxService
  ) {}

  async create(dto: CreateUserDTO): Promise<UserResponseDTO> {
    const normalizedProfile = this.resolveProfileInput(dto);
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
}
