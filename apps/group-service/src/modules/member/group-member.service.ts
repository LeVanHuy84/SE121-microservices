import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CursorPageResponse,
  GroupMemberFilter,
  GroupMemberStatus,
  GroupPermission,
  GroupRole,
} from '@repo/dtos';
import { GroupMember } from 'src/entities/group-member.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class GroupMemberService {
  constructor(
    @InjectRepository(GroupMember)
    private readonly repo: Repository<GroupMember>,
    private readonly dataSource: DataSource,
  ) {}

  async removeMember(groupId: string, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member) throw new Error('Member not found');

      member.status = GroupMemberStatus.REMOVED;
      await manager.save(member);
      return true;
    });
  }

  banMember(groupId: string, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member) throw new Error('Member not found');

      member.status = GroupMemberStatus.BANNED;
      await manager.save(member);
      return true;
    });
  }

  async changeRole(groupId: string, newRole: GroupRole, memberId: string) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member) throw new Error('Member not found');

      member.role = newRole;
      await manager.save(member);
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
      if (!member) throw new Error('Member not found');

      member.customPermissions = permissions;
      await manager.save(member);
      return member;
    });
  }

  async getMembers(
    groupId: string,
    query: GroupMemberFilter,
  ): Promise<CursorPageResponse<GroupMember>> {
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

    return {
      data,
      nextCursor,
      hasNextPage,
    };
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const member = await this.repo.findOne({ where: { groupId, userId } });
    return !!member;
  }
}
