// src/modules/group-authorization/group-role.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupRole } from '@repo/dtos';

@Injectable()
export class GroupRoleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRepository(GroupMember)
    private readonly memberRepo: Repository<GroupMember>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.get<GroupRole>(
      'group_role',
      ctx.getHandler(),
    );

    if (!requiredRole) return true;

    const data = ctx.switchToRpc().getData();
    const { userId, groupId } = data || {};

    if (!userId || !groupId)
      throw new RpcException('Missing user or group context');

    const member = await this.memberRepo.findOne({
      where: { userId, groupId },
    });

    if (!member) throw new RpcException('You are not a group member');

    if (member.role !== requiredRole)
      throw new RpcException(`Required role: ${requiredRole}`);

    return true;
  }
}
