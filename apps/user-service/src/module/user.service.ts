import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';

import {
  BaseUserDTO,
  CreateUserDTO,
  UpdateUserDTO,
  UserResponseDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { eq } from 'drizzle-orm';
import { roles, userRoles } from 'src/drizzle/schema/authorize.schema';
import { profiles } from 'src/drizzle/schema/profiles.schema';
import { users } from 'src/drizzle/schema/users.schema';
import { RedisService } from '@repo/common';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private redisService: RedisService
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

    return plainToInstance(UserResponseDTO, user, {
      excludeExtraneousValues: true,
    });
  }

  async findAll(): Promise<UserResponseDTO[]> {


    const users = await this.db.query.users.findMany({
      with: {
        profile: {
          columns: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
            coverImageUrl: true,
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

    return dtos;
  }

  async findOne(id: string): Promise<UserResponseDTO> {
    const cacheKey = `user:${id}`;
    const cached = await this.redisService.get<UserResponseDTO>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit: ${cacheKey}`);
      return cached;
    }
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
      with: {
        profile: {
          columns: {
            firstName: true,
            lastName: true,
            avatarUrl: true,
            coverImageUrl: true,
            bio: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const dto = plainToInstance(
      UserResponseDTO,
      {
        ...user,
        ...user?.profile,
      },
      {
        excludeExtraneousValues: true,
      }
    );
    await this.redisService.set(cacheKey, dto, 60 * 10);
    return dto;
  }

  async update(id: string, dto: UpdateUserDTO) {
    await this.db.transaction(async (tx) => {
      const user = await tx
        .select()
        .from(users)
        .where(eq(users.id, id))
        .then((u) => u[0]);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (dto.email && dto.email !== user.email) {
        const existingUser = await tx
          .select()
          .from(users)
          .where(eq(users.email, dto.email))
          .then((u) => u[0]);
        if (existingUser) {
          throw new Error('Email already in use');
        }
      }

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

      if (!profile) {
        throw new NotFoundException('Profile not found');
      }

      await tx
        .update(profiles)
        .set({
          firstName: dto.firstName ?? profile.firstName,
          lastName: dto.lastName ?? profile.lastName,
          avatarUrl: dto.avatarUrl ?? profile.avatarUrl,
          coverImageUrl: dto.coverImageUrl ?? profile.coverImageUrl,
          bio: dto.bio ?? profile.bio,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, id));
    });
    const updated = await this.findOne(id);
    // Clear cache
    const cacheKey = `user:${id}`;
    await this.redisService.del(cacheKey);

    // Optionally, you can set the updated value in cache
    await this.redisService.set(cacheKey, updated, 60 * 10);
    return updated;
  }

  async remove(id: string) {
    await this.db.delete(users).where(eq(users.id, id));
    // Clear cache
    await this.redisService.del(`user:${id}`);
    return { success: true };
  }

  async getUsersBatch(ids: string[]): Promise<UserResponseDTO[]> {
    if (!ids.length) return [];

    const results: UserResponseDTO[] = [];
    const missingIds: string[] = [];

    for (const id of ids) {
      const cached = await this.redisService.get<UserResponseDTO>(`user:${id}`);
      if (cached) {
        results.push(cached);
      } else {
        missingIds.push(id);
      }
    }

    
    if (missingIds.length > 0) {
      const usersFromDB = await this.db.query.users.findMany({
        where: (fields, { inArray }) => inArray(fields.id, missingIds),
        with: { profile: true },
      });

      const userDtos = usersFromDB.map((user) =>
        plainToInstance(
          UserResponseDTO,
          { ...user, ...user.profile },
          { excludeExtraneousValues: true }
        )
      );

      // Cache lại từng user
      for (const dto of userDtos) {
        await this.redisService.set(`user:${dto.id}`, dto, 60 * 30); // cache 30 phút
        results.push(dto);
      }
    }

    // 3️⃣ Giữ đúng thứ tự theo mảng ids đầu vào
    const ordered = ids
      .map((id) => results.find((u) => u.id === id))
      .filter(Boolean) as UserResponseDTO[];

    return ordered;
  }
}
