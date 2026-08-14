// src/modules/group-authorization/group-role.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RpcException } from "@nestjs/microservices";
import { GroupRole } from "@repo/dtos";
import { and, eq } from "drizzle-orm";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import type { DrizzleDB } from "src/drizzle/types/drizzle.d";
import { groupMembers } from "src/drizzle/schema/schema";

@Injectable()
export class GroupRoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.get<GroupRole>(
      "group_role",
      ctx.getHandler(),
    );

    if (!requiredRole) return true;

    const data = ctx.switchToRpc().getData();
    const { userId, groupId } = data || {};

    if (!userId || !groupId)
      throw new RpcException({
        statusCode: 400,
        message: "Missing user or group context",
      });

    const [member] = await this.db
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.userId, userId), eq(groupMembers.groupId, groupId)),
      )
      .limit(1);

    if (!member)
      throw new RpcException({
        statusCode: 403,
        message: "You are not a group member",
      });

    if (member.role !== requiredRole)
      throw new RpcException({
        statusCode: 403,
        message: `Required role: ${requiredRole}`,
      });

    return true;
  }
}
