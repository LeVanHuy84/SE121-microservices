import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  CreateSystemUserDTO,
  DashboardQueryDTO,
  LogType,
  PageResponse,
  SystemRole,
  SystemUserDTO,
  SystemUserQueryDTO,
  UserEventType,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import {
  and,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  SQL,
} from 'drizzle-orm';
import { USER_STATUS } from 'src/constants';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import { roles, userRoles } from 'src/drizzle/schema/authorize.schema';
import { profiles } from 'src/drizzle/schema/profiles.schema';
import { users } from 'src/drizzle/schema/users.schema';
import type { DrizzleDB } from 'src/drizzle/types/drizzle';
import { OutboxService } from '../event/outbox.service';
import { CLERK_CLIENT } from '../clerk/clerk.module';
import { countDistinct } from 'drizzle-orm';
import { toUtcEndOfDayVN, toUtcStartOfDayVN } from 'src/utils/time-convert';

@Injectable()
export class AdminService {
  constructor(
    @Inject(DRIZZLE) private db: DrizzleDB,
    private readonly outboxService: OutboxService,
    @Inject(CLERK_CLIENT) private clerkClient
  ) {}

  private readonly VN_OFFSET_HOURS = 7;

  async createSystemUser(
    dto: CreateSystemUserDTO,
    actorId: string
  ): Promise<SystemUserDTO> {
    const sysUser = await this.clerkClient.users.createUser({
      emailAddress: [dto.email],
      firstName: dto.firstName,
      lastName: dto.lastName,
      password: dto.password,
      publicMetadata: {
        role: dto.role,
      },
    });

    try {
      const actor = await this.db
        .select({
          id: users.id,
          email: users.email,
          role: roles.name,
          firstName: profiles.firstName,
          lastName: profiles.lastName,
        })
        .from(users)
        .innerJoin(userRoles, eq(users.id, userRoles.userId))
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .leftJoin(profiles, eq(users.id, profiles.userId))
        .where(eq(users.id, actorId))
        .limit(1)
        .then((rows) => rows[0]);

      const user = await this.db.transaction(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({
            id: sysUser.id,
            email: dto.email,
          })
          .returning();

        await tx.insert(profiles).values({
          userId: user.id,
          firstName: dto.firstName ?? '',
          lastName: dto.lastName ?? '',
          stats: { followers: 0, following: 0, posts: 0 },
        });

        const stringRole = dto.role as string;

        const [defaultRole] = await tx
          .select()
          .from(roles)
          .where(eq(roles.name, stringRole));

        let roleId = defaultRole?.id;
        if (!roleId) {
          const [newRole] = await tx
            .insert(roles)
            .values({
              name: stringRole,
              description: `${stringRole} role`,
            })
            .returning();
          roleId = newRole.id;
        }

        await tx.insert(userRoles).values({
          userId: user.id,
          roleId,
        });

        const loggingPayload = {
          actorId: actorId,
          targetId: user.id,
          action: 'Create system user',
          log: `System user ${dto.firstName} ${dto.lastName} created by ${actor.firstName} ${actor.lastName} with role ${actor.role}`,
          timestamp: new Date(),
        };
        await this.outboxService.createLoggingOutboxEvent(
          tx,
          LogType.USER_LOG,
          loggingPayload
        );

        return user;
      });

      return plainToInstance(SystemUserDTO, user, {
        excludeExtraneousValues: true,
      });
    } catch (err) {
      await this.clerkClient.users.deleteUser(sysUser.id);
      throw err;
    }
  }

  async updateSystemUserRole(
    userId: string,
    newRole: SystemRole,
    actorId: string
  ) {
    const clerkUser = await this.clerkClient.users.getUser(userId);
    if (clerkUser.publicMetadata.isSystemAdmin) {
      throw new RpcException({
        statusCode: 404,
        message: 'Cannot change role of a system admin user',
      });
    }

    await this.clerkClient.users.updateUserMetadata(userId, {
      publicMetadata: { role: newRole },
    });

    const actor = await this.db
      .select({
        id: users.id,
        email: users.email,
        role: roles.name,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(eq(users.id, actorId))
      .limit(1)
      .then((rows) => rows[0]);

    await this.db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      const [role] = await tx
        .select()
        .from(roles)
        .where(eq(roles.name, newRole));

      await tx.insert(userRoles).values({
        userId: userId,
        roleId: role.id,
      });

      const loggingPayload = {
        actorId: actorId,
        targetId: userId,
        action: 'Update user role',
        log: `User role updated to ${newRole} by ${actor.firstName} ${actor.lastName} with role ${actor.role}`,
        timestamp: new Date(),
      };
      await this.outboxService.createLoggingOutboxEvent(
        tx,
        LogType.USER_LOG,
        loggingPayload
      );
    });
    return true;
  }

  async getSystemUsers(
    filter: SystemUserQueryDTO
  ): Promise<PageResponse<SystemUserDTO>> {
    const { query, limit = 10, page = 1, status, role } = filter;
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];

    // ===== ROLE FILTER =====
    if (role) {
      conditions.push(eq(roles.name, role));
    } else {
      conditions.push(
        inArray(roles.name, [SystemRole.ADMIN, SystemRole.MODERATOR])
      );
    }

    // ===== SEARCH QUERY =====
    const searchCondition = query
      ? or(
          ilike(sql`coalesce(${profiles.firstName}, '')`, `%${query}%`),
          ilike(sql`coalesce(${profiles.lastName}, '')`, `%${query}%`),
          ilike(users.email, `%${query}%`)
        )
      : undefined;

    if (searchCondition) {
      conditions.push(searchCondition);
    }

    if (status) {
      conditions.push(eq(users.status, status));
    }

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(and(...conditions));

    const usersList = await this.db
      .select({
        id: users.id,
        email: users.email,
        isActive: users.isActive,
        role: roles.name,
        status: users.status,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(and(...conditions))
      .orderBy(users.createdAt)
      .limit(limit)
      .offset(offset);

    return {
      data: plainToInstance(SystemUserDTO, usersList, {
        excludeExtraneousValues: true,
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async banUser(userId: string, actorId: string) {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        isActive: users.isActive,
        role: roles.name,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(inArray(users.id, [userId, actorId]));

    const map = new Map(rows.map((r) => [r.id, r]));
    const target = map.get(userId);
    const actor = map.get(actorId);

    if (!target)
      throw new RpcException({
        statusCode: 404,
        message: 'User not found',
      });
    if (!actor)
      throw new RpcException({
        statusCode: 404,
        message: 'Actor not found',
      });

    if (target.role !== 'user') {
      throw new RpcException({
        statusCode: 409,
        message: 'Cannot ban non-user role',
      });
    }

    if (target.status === USER_STATUS.BANNED) {
      throw new RpcException({
        statusCode: 409,
        message: 'User already banned',
      });
    }

    // ===== SAGA STEP 1: External =====
    await this.clerkClient.users.banUser(userId);

    try {
      // ===== SAGA STEP 2: Local Transaction =====
      await this.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            isActive: false,
            status: USER_STATUS.BANNED,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        await this.outboxService.createUserOutboxEvent(
          tx,
          UserEventType.REMOVED,
          { userId }
        );

        await this.outboxService.createLoggingOutboxEvent(
          tx,
          LogType.USER_LOG,
          {
            actorId,
            targetId: userId,
            action: 'Ban user',
            log: `User ${target.firstName} ${target.lastName} banned by ${actor.firstName} ${actor.lastName} (${actor.role})`,
            timestamp: new Date(),
          }
        );
      });
      return true;
    } catch (err) {
      // ===== SAGA COMPENSATION =====
      await this.clerkClient.users.unbanUser(userId);
      throw err;
    }
  }

  async unbanUser(userId: string, actorId: string) {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        role: roles.name,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        avatarUrl: profiles.avatarUrl,
        bio: profiles.bio,
      })
      .from(users)
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(inArray(users.id, [userId, actorId]));

    const map = new Map(rows.map((r) => [r.id, r]));
    const target = map.get(userId);
    const actor = map.get(actorId);

    if (!target)
      throw new RpcException({
        statusCode: 404,
        message: 'User not found',
      });
    if (!actor)
      throw new RpcException({
        statusCode: 403,
        message: 'Actor not found',
      });

    if (target.status !== USER_STATUS.BANNED) {
      throw new RpcException({
        statusCode: 409,
        message: 'User is not banned',
      });
    }

    // ===== STEP 1: Clerk =====
    await this.clerkClient.users.unbanUser(userId);

    try {
      // ===== STEP 2: DB =====
      await this.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            isActive: true,
            status: USER_STATUS.ACTIVE,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        await this.outboxService.createUserOutboxEvent(
          tx,
          UserEventType.CREATED,
          {
            userId,
            email: target.email,
            firstName: target.firstName ?? '',
            lastName: target.lastName ?? '',
            avatarUrl: target.avatarUrl ?? '',
            bio: target.bio ?? '',
            isActive: true,
            createdAt: new Date(),
          }
        );

        await this.outboxService.createLoggingOutboxEvent(
          tx,
          LogType.USER_LOG,
          {
            actorId,
            targetId: userId,
            action: 'Unban user',
            log: `User ${target.firstName} ${target.lastName} unbanned by ${actor.firstName} ${actor.lastName} (${actor.role})`,
            timestamp: new Date(),
          }
        );
      });
      return true;
    } catch (err) {
      // ===== COMPENSATION =====
      await this.clerkClient.users.banUser(userId);
      throw err;
    }
  }

  async getDashboard(
    filter: DashboardQueryDTO
  ): Promise<{ activeUsers: number }> {
    // ===== TODAY (VN)
    const todayVN = new Date();
    todayVN.setHours(0, 0, 0, 0);

    let fromDate = this.vnDateToUtcStart(filter.from);
    let toDate = this.vnDateToUtcEnd(filter.to);

    // default = 30 ngày gần nhất (VN)
    if (!toDate) {
      toDate = this.vnDateToUtcEnd(todayVN)!;
    }

    if (!fromDate) {
      const d = new Date(todayVN);
      d.setDate(d.getDate() - 29);
      fromDate = this.vnDateToUtcStart(d)!;
    }

    const [activeResult] = await this.db
      .select({
        count: countDistinct(users.id),
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          isNull(users.deletedAt),
          eq(users.isActive, true),
          eq(users.status, USER_STATUS.ACTIVE),
          eq(roles.name, SystemRole.USER as string),
          gte(users.updatedAt, fromDate),
          lte(users.updatedAt, toDate)
        )
      );

    return {
      activeUsers: Number(activeResult.count ?? 0),
    };
  }

  private normalizeToVNDate(value: string | Date): {
    y: number;
    m: number;
    d: number;
  } {
    let vnDate: Date;

    if (value instanceof Date) {
      vnDate = new Date(value);
    } else if (value.includes('T')) {
      // ISO string → Date
      vnDate = new Date(value);
    } else {
      // YYYY-MM-DD → coi là VN
      const [y, m, d] = value.split('-').map(Number);
      return { y, m, d };
    }

    // Convert UTC → VN
    vnDate = new Date(vnDate.getTime() + this.VN_OFFSET_HOURS * 60 * 60 * 1000);

    return {
      y: vnDate.getFullYear(),
      m: vnDate.getMonth() + 1,
      d: vnDate.getDate(),
    };
  }

  private vnDateToUtcStart(value?: Date | string): Date | undefined {
    if (!value) return undefined;

    const { y, m, d } = this.normalizeToVNDate(value);

    return new Date(Date.UTC(y, m - 1, d, -this.VN_OFFSET_HOURS, 0, 0, 0));
  }

  private vnDateToUtcEnd(value?: Date | string): Date | undefined {
    if (!value) return undefined;

    const { y, m, d } = this.normalizeToVNDate(value);

    return new Date(
      Date.UTC(y, m - 1, d, 23 - this.VN_OFFSET_HOURS, 59, 59, 999)
    );
  }
}
