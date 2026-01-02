import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { GroupPermission, GroupRole } from '@repo/dtos';
import { ROLE_PERMISSIONS } from 'src/common/constant/role-permission.constant';
import { GroupMember } from 'src/entities/group-member.entity';
import { Repository } from 'typeorm';

@Injectable()
export class GroupPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRepository(GroupMember)
    private readonly memberRepo: Repository<GroupMember>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // 🧠 Lấy permission được yêu cầu từ decorator
    const requiredAction = this.reflector.get<GroupPermission>(
      'group_permission',
      ctx.getHandler(),
    );
    if (!requiredAction) return true; // không yêu cầu permission cụ thể

    // 📦 Lấy payload từ message RPC
    const data = ctx.switchToRpc().getData();
    const { userId, groupId } = data || {};

    if (!userId || !groupId)
      throw new RpcException({
        statusCode: 400,
        message: 'Missing user or group context',
      });
    const member = await this.memberRepo.findOne({
      where: { userId, groupId },
    });
    if (!member)
      throw new RpcException({
        statusCode: 403,
        message: 'You are not a group member',
      });

    if (member.role === GroupRole.OWNER) return true; // Chủ nhóm có tất cả quyền

    // ✅ Ưu tiên custom permission
    if (member.customPermissions?.includes(requiredAction)) return true;

    // ✅ Kiểm tra permission theo role mặc định
    const allowed =
      ROLE_PERMISSIONS[member.role as GroupRole]?.includes(requiredAction);

    if (!allowed)
      throw new RpcException({
        statusCode: 404,
        message: `You don't have permission: ${requiredAction}`,
      });

    return true;
  }
}
