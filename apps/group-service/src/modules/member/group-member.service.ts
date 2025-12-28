import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CursorPageResponse,
  EventDestination,
  GroupEventLog,
  GroupMemberDTO,
  GroupMemberFilter,
  GroupMemberStatus,
  GroupPermission,
  GroupRole,
  NotiOutboxPayload,
  NotiTargetType,
} from '@repo/dtos';
import { GroupMember } from 'src/entities/group-member.entity';
import { DataSource, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { Group } from 'src/entities/group.entity';
import { plainToInstance } from 'class-transformer';
import { GroupLogService } from '../group-log/group-log.service';

@Injectable()
export class GroupMemberService {
  constructor(
    @InjectRepository(GroupMember)
    private readonly repo: Repository<GroupMember>,
    private readonly dataSource: DataSource,
    private readonly groupLogService: GroupLogService,
  ) {}

  async leaveGroup(userId: string, groupId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { userId, groupId },
      });
      if (!member)
        throw new RpcException({
          statusCode: 404,
          message: 'Member not found',
        });
      if (member.role === GroupRole.OWNER) {
        throw new RpcException({
          statusCode: 403,
          message: 'Owner cannot leave the group',
        });
      }
      await manager.delete(GroupMember, member.id);
      await this.groupLogService.log(manager, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_LEFT,
        content: `Thành viên ${userId} rời khỏi nhóm`,
      });

      await this.updateMemberCount(manager, groupId, -1);
      return true;
    });
  }

  async removeMember(userId: string, groupId: string, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member)
        throw new RpcException({
          statusCode: 404,
          message: 'Member not found',
        });

      if (member.role === GroupRole.OWNER) {
        throw new RpcException({
          statusCode: 403,
          message: 'Cannot remove the group owner',
        });
      }

      const executor = await this.getMemberWithRole(manager, groupId, userId);

      // Nếu victim là admin, executor phải là OWNER mới được remove
      if (
        member.role === GroupRole.ADMIN &&
        executor.role !== GroupRole.OWNER
      ) {
        throw new RpcException({
          statusCode: 403,
          message: 'Only owner can remove an admin',
        });
      }

      // Không remove chính mình
      if (userId === member.userId) {
        throw new RpcException({
          statusCode: 409,
          message: 'You cannot remove yourself',
        });
      }

      // Chỉ remove member đang active
      if (member.status !== GroupMemberStatus.ACTIVE) {
        throw new RpcException({
          statusCode: 409,
          message: 'Member is not active',
        });
      }

      await manager.delete(GroupMember, member.id);

      await this.groupLogService.log(manager, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_REMOVED,
        content: `Thành viên ${memberId} bị xóa khỏi nhóm bởi ${userId}`,
      });

      await this.updateMemberCount(manager, groupId, -1);

      return true;
    });
  }

  banMember(userId: string, groupId: string, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member)
        throw new RpcException({
          statusCode: 404,
          message: 'Member not found',
        });

      if (member.role === GroupRole.OWNER) {
        throw new RpcException({
          statusCode: 403,
          message: 'Cannot ban the group owner',
        });
      }

      const executor = await this.getMemberWithRole(manager, groupId, userId);

      // Nếu victim là admin, executor phải là OWNER mới được remove
      if (
        member.role === GroupRole.ADMIN &&
        executor.role !== GroupRole.OWNER
      ) {
        throw new RpcException({
          statusCode: 403,
          message: 'Only owner can ban an admin',
        });
      }

      // Không remove chính mình
      if (userId === member.userId) {
        throw new RpcException({
          statusCode: 409,
          message: 'You cannot ban yourself',
        });
      }

      // Chỉ remove member đang active
      if (member.status !== GroupMemberStatus.ACTIVE) {
        throw new RpcException({
          statusCode: 409,
          message: 'Member is not active',
        });
      }

      member.status = GroupMemberStatus.BANNED;
      await manager.save(member);

      await this.groupLogService.log(manager, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_BANNED,
        content: `Thành viên ${memberId} bị cấm khỏi nhóm bởi ${userId}`,
      });

      await this.updateMemberCount(manager, groupId, -1);
      return true;
    });
  }

  unbanMember(userId: string, groupId: string, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member)
        throw new RpcException({
          statusCode: 404,
          message: 'Member not found',
        });
      if (member.status !== GroupMemberStatus.BANNED) {
        throw new RpcException({
          statusCode: 409,
          message: 'Member is not banned',
        });
      }
      await manager.delete(GroupMember, member.id);
      await this.groupLogService.log(manager, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_UNBANNED,
        content: `Thành viên ${memberId} được bỏ cấm khỏi nhóm bởi ${userId}`,
      });
      return true;
    });
  }

  async changeRole(
    userId: string,
    groupId: string,
    newRole: GroupRole,
    memberId: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      if (newRole === GroupRole.OWNER) {
        throw new RpcException({
          statusCode: 403,
          message: 'Cannot assign OWNER role',
        });
      }

      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
        relations: ['group'],
      });
      if (!member)
        throw new RpcException({
          statusCode: 404,
          message: 'Member not found',
        });

      if (member.role === GroupRole.OWNER) {
        throw new RpcException({
          statusCode: 403,
          message: 'Cannot change role of the group owner',
        });
      }

      const executor = await this.getMemberWithRole(manager, groupId, userId);

      if (
        member.role === GroupRole.ADMIN &&
        executor.role !== GroupRole.OWNER
      ) {
        throw new RpcException({
          statusCode: 403,
          message: 'Only owner can change role of admin',
        });
      }

      member.role = newRole;
      await manager.save(member);
      await this.groupLogService.log(manager, {
        groupId,
        userId: memberId,
        eventType: GroupEventLog.MEMBER_ROLE_CHANGED,
        content: `Vai trò của thành viên ${memberId} đã được thay đổi thành ${newRole}`,
      });
      await this.createOutboxEvent(
        manager,
        member.group.id,
        member.userId,
        `Vai trò của bạn trong nhóm ${member.group.name} đã được cập nhật thành ${newRole}`,
      );
      return member;
    });
  }

  async addPermission(
    groupId: string,
    memberId: string,
    permissions: GroupPermission[],
  ) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member)
        throw new RpcException({
          statusCode: 404,
          message: 'Member not found',
        });

      if (member.role === GroupRole.OWNER) {
        throw new RpcException({
          statusCode: 403,
          message: 'Cannot change permissions of the group owner',
        });
      }

      member.customPermissions = permissions;
      await manager.save(member);

      await this.groupLogService.log(manager, {
        groupId,
        userId: memberId,
        eventType: GroupEventLog.MEMBER_PERMISSION_CHANGED,
        content: `Quyền hạn của thành viên ${memberId} đã được thay đổi thành ${permissions.join(', ')}`,
      });

      await this.createOutboxEvent(
        manager,
        member.group.id,
        member.userId,
        `Quyền hạn của bạn trong nhóm ${member.group.name} đã được cập nhật`,
      );

      return member;
    });
  }

  async getMembers(
    groupId: string,
    query: GroupMemberFilter,
  ): Promise<CursorPageResponse<GroupMemberDTO>> {
    const { role, status, sortBy, order, cursor, limit } = query;

    const qb = this.repo.createQueryBuilder('member');
    qb.where('member.groupId = :groupId', { groupId });
    if (role) {
      qb.andWhere('member.role = :role', { role });
    }

    if (status) {
      qb.andWhere('member.status = :status', { status });
    }
    if (cursor) {
      qb.andWhere('member.id < :cursor', { cursor });
    }
    qb.orderBy(`member.${sortBy || 'createdAt'}`, order);
    qb.limit(limit + 1);

    const data = await qb.getMany();
    const hasNextPage = data.length > limit;
    const nextCursor = hasNextPage ? data[limit - 1].id : null;
    const resultData = hasNextPage ? data.slice(0, limit) : data;

    const dtoData = plainToInstance(GroupMemberDTO, resultData, {
      excludeExtraneousValues: true,
    });

    return {
      data: dtoData,
      nextCursor,
      hasNextPage,
    };
  }

  async getMemberUserIds(groupId: string): Promise<string[]> {
    const rows = await this.repo
      .createQueryBuilder('member')
      .select('member.userId', 'userId')
      .where('member.groupId = :groupId', { groupId })
      .getRawMany<{ userId: string }>();

    return rows.map((r) => r.userId);
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const member = await this.repo.findOne({ where: { groupId, userId } });
    return !!member;
  }

  private async createOutboxEvent(
    manager,
    groupId: string,
    receiverId: string,
    content: string,
  ) {
    const outboxRepo = manager.getRepository(OutboxEvent);

    const payload: NotiOutboxPayload = {
      targetId: groupId,
      targetType: NotiTargetType.GROUP,
      content,
      receivers: [receiverId],
    };

    const event = outboxRepo.create({
      destination: EventDestination.RABBITMQ,
      topic: 'notification',
      eventType: 'group_noti',
      payload,
    });

    await outboxRepo.save(event);
  }

  private async updateMemberCount(manager, groupId: string, delta: number) {
    const groupRepo = manager.getRepository(Group);
    const group = await groupRepo.findOne({ where: { id: groupId } });
    if (!group)
      throw new RpcException({
        statusCode: 404,
        message: 'Group not found',
      });
    group.members += delta;
    await groupRepo.save(group);
  }

  private async getMemberWithRole(manager, groupId: string, userId: string) {
    return manager.findOne(GroupMember, {
      where: { groupId, userId },
      relations: ['group'],
    });
  }
}
