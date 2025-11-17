import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CursorPageResponse,
  EventDestination,
  GroupEventLog,
  GroupMemberDTO,
  GroupMemberFilter,
  GroupMemberStatus,
  GroupNotificationType,
  GroupPermission,
  GroupRole,
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

  async removeMember(userId: string, groupId: string, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member) throw new RpcException('Member not found');

      if (member.role === GroupRole.OWNER) {
        throw new RpcException('Cannot remove the group owner');
      }

      const executor = await this.getMemberWithRole(manager, groupId, userId);

      // Nếu victim là admin, executor phải là OWNER mới được remove
      if (
        member.role === GroupRole.ADMIN &&
        executor.role !== GroupRole.OWNER
      ) {
        throw new RpcException('Only owner can remove an admin');
      }

      // Không remove chính mình
      if (userId === member.userId) {
        throw new RpcException('You cannot remove yourself');
      }

      // Chỉ remove member đang active
      if (member.status !== GroupMemberStatus.ACTIVE) {
        throw new RpcException('Member is not active');
      }

      member.status = GroupMemberStatus.REMOVED;
      await manager.save(member);

      await this.groupLogService.log(manager, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_REMOVED,
        content: `Member ${memberId} removed from group by ${userId}`,
      });

      return true;
    });
  }

  banMember(userId: string, groupId: string, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member) throw new RpcException('Member not found');

      if (member.role === GroupRole.OWNER) {
        throw new RpcException('Cannot remove the group owner');
      }

      const executor = await this.getMemberWithRole(manager, groupId, userId);

      // Nếu victim là admin, executor phải là OWNER mới được remove
      if (
        member.role === GroupRole.ADMIN &&
        executor.role !== GroupRole.OWNER
      ) {
        throw new RpcException('Only owner can remove an admin');
      }

      // Không remove chính mình
      if (userId === member.userId) {
        throw new RpcException('You cannot remove yourself');
      }

      // Chỉ remove member đang active
      if (member.status !== GroupMemberStatus.ACTIVE) {
        throw new RpcException('Member is not active');
      }

      member.status = GroupMemberStatus.BANNED;
      await manager.save(member);

      await this.groupLogService.log(manager, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_BANNED,
        content: `Member ${memberId} banned from group by ${userId}`,
      });
      return true;
    });
  }

  unbanMember(userId: string, groupId: string, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member) throw new RpcException('Member not found');
      if (member.status !== GroupMemberStatus.BANNED) {
        throw new RpcException('Member is not banned');
      }
      member.status = GroupMemberStatus.REMOVED;
      await manager.save(member);
      await this.groupLogService.log(manager, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_UNBANNED,
        content: `Member ${memberId} unbanned in group by ${userId}`,
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
        throw new RpcException('Cannot assign OWNER role');
      }

      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
        relations: ['group'],
      });
      if (!member) throw new RpcException('Member not found');

      if (member.role === GroupRole.OWNER) {
        throw new RpcException('Cannot change role of the group owner');
      }

      const executor = await this.getMemberWithRole(manager, groupId, userId);

      if (
        member.role === GroupRole.ADMIN &&
        executor.role !== GroupRole.OWNER
      ) {
        throw new RpcException('Only owner can change role of admin');
      }

      member.role = newRole;
      await manager.save(member);
      await this.groupLogService.log(manager, {
        groupId,
        userId: memberId,
        eventType: GroupEventLog.MEMBER_ROLE_CHANGED,
        content: `Member ${memberId} role changed to ${newRole}`,
      });
      await this.createOutboxEvent(
        manager,
        member.group,
        member.userId,
        `Your role in group ${member.group.name} has been changed to ${newRole}`,
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
      if (!member) throw new RpcException('Member not found');

      if (member.role === GroupRole.OWNER) {
        throw new RpcException('Cannot change permissions of the group owner');
      }

      member.customPermissions = permissions;
      await manager.save(member);

      await this.groupLogService.log(manager, {
        groupId,
        userId: memberId,
        eventType: GroupEventLog.MEMBER_PERMISSION_CHANGED,
        content: `Member ${memberId} permissions changed to ${permissions.join(', ')}`,
      });

      await this.createOutboxEvent(
        manager,
        member.group,
        member.userId,
        `Your permissions in group ${member.group.name} have been updated`,
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
    group: Group,
    receiverId: string,
    content: string,
  ) {
    const outboxRepo = manager.getRepository(OutboxEvent);

    const event = outboxRepo.create({
      destination: EventDestination.RABBITMQ,
      topic: 'group_event',
      eventType: GroupNotificationType.GROUP_ROLE_CHANGED,
      payload: {
        groupId: group.id,
        groupName: group.name,
        groupAvatarUrl: group.avatarUrl,
        content,
        reviewerIds: [receiverId],
      },
    });

    await outboxRepo.save(event);
  }

  private async getMemberWithRole(manager, groupId: string, userId: string) {
    return manager.findOne(GroupMember, {
      where: { groupId, userId },
      relations: ['group'],
    });
  }
}
