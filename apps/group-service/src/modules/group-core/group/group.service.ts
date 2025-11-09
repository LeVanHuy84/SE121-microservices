import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  CreateGroupDTO,
  CursorPageResponse,
  GroupResponseDTO,
  GroupRole,
  GroupStatus,
  SearchGroupDTO,
  UpdateGroupDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { Group } from 'src/entities/group.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupSetting } from 'src/entities/group-setting.entity';
import { DataSource } from 'typeorm';
import { validate as isUUID } from 'uuid';

@Injectable()
export class GroupService {
  constructor(private readonly dataSource: DataSource) {}

  // 📌 Find group by ID
  async findById(groupId: string): Promise<GroupResponseDTO> {
    if (!isUUID(groupId)) {
      throw new RpcException('Invalid group ID format');
    }

    const entity = await this.dataSource
      .getRepository(Group)
      .findOne({ where: { id: groupId } });

    if (!entity) {
      throw new RpcException('Group not found');
    }

    return plainToInstance(GroupResponseDTO, entity, {
      excludeExtraneousValues: true,
    });
  }

  // 📌 Search groups
  async search(
    query: SearchGroupDTO,
  ): Promise<CursorPageResponse<GroupResponseDTO>> {
    const { q, cursor, limit, sortBy, order, privacy } = query;

    const qb = this.dataSource
      .getRepository(Group)
      .createQueryBuilder('group')
      .where('group.status = :status', { status: GroupStatus.ACTIVE });

    if (q) {
      qb.andWhere('(group.name ILIKE :q OR group.description ILIKE :q)', {
        q: `%${q}%`,
      });
    }

    if (privacy) {
      qb.andWhere('group.privacy = :privacy', { privacy });
    }

    if (cursor) {
      qb.andWhere('group.id > :cursor', { cursor });
    }

    qb.orderBy(`group.${sortBy ?? 'createdAt'}`, order).take(limit + 1);

    const groups = await qb.getMany();

    const hasNext = groups.length > limit;
    const data = groups.slice(0, limit);
    const nextCursor = hasNext ? data[data.length - 1].id : null;

    const groupDTOs = data.map((group) =>
      plainToInstance(GroupResponseDTO, group),
    );

    return new CursorPageResponse<GroupResponseDTO>(
      groupDTOs,
      nextCursor,
      hasNext,
    );
  }

  // 📌 Create group (with transaction)
  async createGroup(
    userId: string,
    dto: CreateGroupDTO,
  ): Promise<GroupResponseDTO> {
    return this.dataSource.transaction(async (manager) => {
      // 1️⃣ Tạo group + setting mặc định
      const newGroup = manager.create(Group, {
        ...dto,
        createdBy: userId,
        groupSetting: new GroupSetting(), // tự apply default
      });
      newGroup.groupSetting.createdBy = userId;

      const savedGroup = await manager.save(newGroup);

      // 2️⃣ Tạo group member cho user
      const groupMember = manager.create(GroupMember, {
        userId,
        groupId: savedGroup.id,
        role: GroupRole.ADMIN,
        group: savedGroup,
      });
      await manager.save(groupMember);

      // 3️⃣ Trả về DTO
      return plainToInstance(GroupResponseDTO, savedGroup, {
        excludeExtraneousValues: true,
      });
    });
  }

  // 📌 Update group
  async updateGroup(
    userId: string,
    groupId: string,
    dto: Partial<UpdateGroupDTO>,
  ): Promise<GroupResponseDTO> {
    const repo = this.dataSource.getRepository(Group);
    const group = await repo.findOne({ where: { id: groupId } });

    if (!group) {
      throw new RpcException('Group not found');
    }

    const assignedGroup = Object.assign(group, dto);
    assignedGroup.updatedBy = userId;
    const updatedGroup = await repo.save(assignedGroup);

    return plainToInstance(GroupResponseDTO, updatedGroup, {
      excludeExtraneousValues: true,
    });
  }

  // 📌 Delete group (soft delete)
  async deleteGroup(userId: string, groupId: string): Promise<boolean> {
    const repo = this.dataSource.getRepository(Group);
    const group = await repo.findOne({ where: { id: groupId } });

    if (!group) {
      throw new RpcException('Group not found');
    }

    group.updatedBy = userId;
    group.status = GroupStatus.DELETED;
    await repo.save(group);
    return true;
  }
}
