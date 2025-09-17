import { Inject, Injectable } from '@nestjs/common';

import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { users } from 'src/drizzle/schema/users.schema';
import { profiles } from 'src/drizzle/schema/profiles.schema';
import { roles, userRoles } from 'src/drizzle/schema/authorize.schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class UserService {
  constructor(@Inject(DRIZZLE) private db: DrizzleDB) {}
  async create(dto: CreateUserDto) {
    return await this.db.transaction(async (tx) => {
      
      const [user] = await tx.insert(users).values({
        email: dto.email,
        username: dto.username,
        clerkId: dto.clerkId, 
      }).returning();

     
      await tx.insert(profiles).values({
        userId: user.id,
        fullName: dto.fullName ?? '',
        avatarUrl: dto.avatar ?? null,
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

      return user;
    });
  }

  async findAll() {
    return await this.db.query.users.findMany({
      with: {
        profile: true
      }
    });
  }

  async findOne(id: string) {
    return await this.db.query.users.findFirst({
      where: eq(users.id, id),
      with: { profile: true },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    return await this.db.transaction(async (tx) => {
    
      const userUpdateData: any = { updatedAt: new Date() };
      if (dto.email) userUpdateData.email = dto.email;

      if (Object.keys(userUpdateData).length > 1) { 
      await tx.update(users)
        .set(userUpdateData)
        .where(eq(users.id, id));
    }

    
    const profileUpdateData: any = { updatedAt: new Date() };
    if (dto.fullName) profileUpdateData.fullName = dto.fullName;
    if (dto.avatar) profileUpdateData.avatarUrl = dto.avatar;
    if (dto.bio) profileUpdateData.bio = dto.bio;

    if (Object.keys(profileUpdateData).length > 1) { 
      await tx.update(profiles)
        .set(profileUpdateData)
        .where(eq(profiles.userId, id));
    }

  
    return this.findOne(id);
  });
  }

  async remove(id: string) {
    await this.db.delete(users).where(eq(users.id, id));
    return { success: true };
  }
}
