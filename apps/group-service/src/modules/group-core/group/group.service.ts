import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CreateGroupDTO,
  GroupResponseDTO,
  GroupRole,
  GroupStatus,
  UpdateGroupDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupMember } from 'src/entities/group-member.entity';
import { Group } from 'src/entities/group.entity';
import { Repository } from 'typeorm';

@Injectable()
export class GroupService {
  constructor(
    @InjectRepository(Group) private groupRepository: Repository<Group>,
    @InjectRepository(GroupMember)
    private groupMemberRepository: Repository<GroupMember>,
  ) {}

  async findById(groupId: string): Promise<GroupResponseDTO> {
    const entity = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    return plainToInstance(GroupResponseDTO, entity, {
      excludeExtraneousValues: true,
    });
  }

  async createGroup(
    userId: string,
    dto: CreateGroupDTO,
  ): Promise<GroupResponseDTO> {
    // 1️⃣ Tạo entity group
    const newGroup = this.groupRepository.create(dto);
    newGroup.createdBy = userId;
    const savedGroup = await this.groupRepository.save(newGroup);

    // 2️⃣ Tạo bản ghi group member cho user tạo group
    const groupMember = this.groupMemberRepository.create({
      userId,
      groupId: savedGroup.id,
      role: GroupRole.ADMIN,
      group: savedGroup,
    });
    await this.groupMemberRepository.save(groupMember);

    // 3️⃣ Trả về response
    return plainToInstance(GroupResponseDTO, savedGroup, {
      excludeExtraneousValues: true,
    });
  }

  async updateGroup(
    userId: string,
    groupId: string,
    dto: Partial<UpdateGroupDTO>,
  ): Promise<GroupResponseDTO> {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });

    if (!group) {
      throw new RpcException('Group not found');
    }

    const assignedGroup = Object.assign(group, dto);
    assignedGroup.updatedBy = userId;
    const updatedGroup = await this.groupRepository.save(assignedGroup);
    return plainToInstance(GroupResponseDTO, updatedGroup, {
      excludeExtraneousValues: true,
    });
  }

  async deleteGroup(userId: string, groupId: string): Promise<boolean> {
    const group = await this.groupRepository.findOne({
      where: { id: groupId },
    });
    if (!group) {
      throw new RpcException('Group not found');
    }
    group.updatedBy = userId;
    group.status = GroupStatus.DELETED;
    await this.groupRepository.save(group);
    return true;
  }
}
