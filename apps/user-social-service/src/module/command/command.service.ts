import { Inject, Injectable } from '@nestjs/common';
import { SystemRole } from '@repo/dtos';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { roles, userRoles } from 'src/drizzle/schema/authorize.schema';
import { profiles } from 'src/drizzle/schema/profiles.schema';
import { users } from 'src/drizzle/schema/users.schema';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';
import { CLERK_CLIENT } from '../clerk/clerk.module';

@Injectable()
export class CommandService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    @Inject(CLERK_CLIENT) private clerkClient
  ) {}

  async run() {
    console.log('🏁 Running startup command...');

    // Kiểm tra clerk đã có root admin chưa, nếu chưa thì tạo mới
    const rootEmail = process.env.SYSTEM_ADMIN_EMAIL!;
    const rootPassword = process.env.SYSTEM_ADMIN_PASSWORD!;

    const existing = await this.clerkClient.users.getUserList({
      emailAddress: [rootEmail],
    });

    if (existing.totalCount > 0) {
      console.log('System admin already exists, skip');
      return;
    }

    if (existing.totalCount === 0) {
      console.log('Creating system admin user...');
      const sysAdmin = await this.clerkClient.users.createUser({
        emailAddress: [rootEmail],
        password: rootPassword,
        firstName: 'System',
        lastName: 'Admin',
        publicMetadata: { role: 'admin', isSystemAdmin: true },
      });

      const user = await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            id: sysAdmin.id,
            email: rootEmail,
          })
          .onConflictDoUpdate({
            target: users.email,
            set: { id: sysAdmin.id },
          })
          .returning();

        await tx.insert(profiles).values({
          userId: user.id,
          firstName: 'System',
          lastName: 'Admin',
          avatarUrl: null,
          postCount: 0,
          friendCount: 0,
        }).onConflictDoNothing();

        const [defaultRole] = await tx
          .select()
          .from(roles)
          .where(eq(roles.name, SystemRole.ADMIN as string));

        let roleId = defaultRole?.id;
        if (!roleId) {
          const [newRole] = await tx
            .insert(roles)
            .values({
              name: SystemRole.ADMIN as string,
              description: 'Default admin role',
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
    }

    console.log('✅ Done');
  }
}
