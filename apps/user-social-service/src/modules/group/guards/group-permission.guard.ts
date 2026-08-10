import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import { GroupPermission, GroupRole } from '@repo/dtos';
import { ROLE_PERMISSIONS } from 'src/modules/group/common/constant/role-permission.constant';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import { groupMembers } from 'src/drizzle/schema/schema';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class GroupPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requiredAction = this.reflector.get<GroupPermission>(
      'group_permission',
      ctx.getHandler(),
    );
    if (!requiredAction) return true;

    const data = ctx.switchToRpc().getData();
    const { userId, groupId } = data || {};

    if (!userId || !groupId)
      throw new RpcException({
        statusCode: 400,
        message: 'Missing user or group context',
      });

    const [member] = await this.db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, userId),
          eq(groupMembers.groupId, groupId),
        ),
      )
      .limit(1);

    if (!member)
      throw new RpcException({
        statusCode: 403,
        message: 'You are not a group member',
      });

    if (member.role === GroupRole.OWNER) return true;

    if ((member.customPermissions as string[] | null)?.includes(requiredAction))
      return true;

    const allowed =
      ROLE_PERMISSIONS[member.role as GroupRole]?.includes(requiredAction);

    if (!allowed)
      throw new RpcException({
        statusCode: 403,
        message: `You don't have permission: ${requiredAction}`,
      });

    return true;
  }
}
