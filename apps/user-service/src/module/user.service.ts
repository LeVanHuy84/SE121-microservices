import { Inject, Injectable, Logger } from '@nestjs/common';

import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';

import { CreateUserDTO, UpdateUserDTO, UserResponseDTO } from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { eq } from 'drizzle-orm';
import { roles, userRoles } from 'src/drizzle/schema/authorize.schema';
import { profiles } from 'src/drizzle/schema/profiles.schema';
import { users } from 'src/drizzle/schema/users.schema';


@Injectable()
export class UserService {
  private readonly logger = new Logger();
  constructor(@Inject(DRIZZLE) private db: DrizzleDB) { }
  async create(dto: CreateUserDTO): Promise<UserResponseDTO> {
    const user= await this.db.transaction(async (tx) => {

      const [user] = await tx.insert(users).values({
        email: dto.email,
        clerkId: dto.clerkId,
      }).returning();


      await tx.insert(profiles).values({
        userId: user.id,
        firstName: dto.firstName ?? '',
        lastName: dto.lastName ?? '',
        avatarUrl: dto.avatarUrl ?? null,
        stats: { followers: 0, following: 0, posts: 0 },
      });

      const [defaultRole] = await tx.select()
        .from(roles)
        .where(eq(roles.name, 'user'));


      let roleId = defaultRole?.id;
      if (!roleId) {
        const [newRole] = await tx.insert(roles).values({
          name: 'user',
          description: 'Default user role',
        }).returning();
        roleId = newRole.id;
      }


      await tx.insert(userRoles).values({
        userId: user.id,
        roleId,
      });

      return user
    });


    return plainToInstance(UserResponseDTO, user, {
      excludeExtraneousValues: true,
    });  
  
    
  }

  async findAll(): Promise<UserResponseDTO[]>{
    const users = await this.db.query.users.findMany({
      with: {
        profile: true
      }
    });

    return plainToInstance(UserResponseDTO, users, {
      excludeExtraneousValues: true,
    });
  }

  async findOne(id: string): Promise<UserResponseDTO> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, id),
      with: { profile: true },
    });
    return plainToInstance(UserResponseDTO, user, {
      excludeExtraneousValues: true,
    });
  }

  async update(id: string, dto: UpdateUserDTO): Promise<UserResponseDTO> {
    const userUpdated = await this.db.transaction(async (tx) => {

      const userUpdateData: any = { updatedAt: new Date() };
      if (dto.email) userUpdateData.email = dto.email;

      if (Object.keys(userUpdateData).length > 1) {
        await tx.update(users)
          .set(userUpdateData)
          .where(eq(users.id, id));
      }


      const profileUpdateData: any = { updatedAt: new Date() };
      if (dto.firstName) profileUpdateData.firstName = dto.firstName;
      if (dto.lastName) profileUpdateData.last_name = dto.lastName;
      if (dto.coverImageUrl) profileUpdateData.coverImage = dto.coverImageUrl
      if (dto.avatarUrl) profileUpdateData.avatarUrl = dto.avatarUrl;
      if (dto.bio) profileUpdateData.bio = dto.bio;

      if (Object.keys(profileUpdateData).length > 1) {
        await tx.update(profiles)
          .set(profileUpdateData)
          .where(eq(profiles.userId, id));
      }


      return this.findOne(id);
    });

    return plainToInstance(UserResponseDTO, userUpdated, {
      excludeExtraneousValues: true,
    });
  }

  async remove(id: string) {
    await this.db.delete(users).where(eq(users.id, id));
    return { success: true };
  }

  async getUsersBatch(ids: string[]): Promise<UserResponseDTO[]> {
    if (!ids.length) return [];

    const users = await this.db.query.users.findMany(
      {
        where: (fields, { inArray }) => inArray(fields.id, ids),
        with: {profile: true}
      }

    )
    return plainToInstance(UserResponseDTO, users, {
      excludeExtraneousValues: true,
    });
    
  }
}
