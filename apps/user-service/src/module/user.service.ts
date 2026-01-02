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
  BASE_USER: 300,
};

@Injectable()
export class UserService {
  private readonly logger = new Logger();

  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    @InjectRedis() private redis: Redis,
    private outboxService: OutboxService
  ) {}

  async create(dto: CreateUserDTO): Promise<UserResponseDTO> {
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
        firstName: dto.firstName ?? '',
        lastName: dto.lastName ?? '',
        avatarUrl: dto.avatarUrl ?? null,
        coverImage: null,
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
      firstName: dto.firstName,
      lastName: dto.lastName,
      avatarUrl: dto.avatarUrl,
      bio: dto.bio,
      isActive: true,
      createdAt: new Date(),
    };

    await this.outboxService.createUserOutboxEvent(
      this.db,
      UserEventType.CREATED,
      payload
    );

    return plainToInstance(UserResponseDTO, user, {
      excludeExtraneousValues: true,
    });
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

      // Resolve final profile state
      const updatedProfile = {
        firstName: dto.firstName ?? profile.firstName,
        lastName: dto.lastName ?? profile.lastName,
        avatarUrl: dto.avatarUrl ?? profile.avatarUrl,
        coverImage: dto.coverImage ?? profile.coverImage,
        bio: dto.bio ?? profile.bio,
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
      avatarUrl: finalProfile.avatarUrl,
      bio: finalProfile.bio,
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

    return plainToInstance(UserResponseDTO, result, {
      excludeExtraneousValues: true,
    });
  }

  async getBaseUsersBatch(ids: string[]): Promise<Record<string, BaseUserDTO>> {
    if (!ids.length) return {};

    const cacheKey = `baseUsers:${ids.sort().join(',')}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

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

    await this.redis.set(
      cacheKey,
      JSON.stringify(result),
      'EX',
      CACHE_TTL.BASE_USER
    );
    return result;
  }
}
