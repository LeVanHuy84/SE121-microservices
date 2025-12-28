import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import {
  CreateGroupDTO,
  EventDestination,
  EventTopic,
  GroupEventLog,
  GroupEventType,
  GroupResponseDTO,
  GroupRole,
  GroupStatus,
  InferGroupPayload,
  UpdateGroupDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { Group } from 'src/entities/group.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupSetting } from 'src/entities/group-setting.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { GroupCacheService } from './group-cache.service';
import { GroupLogService } from 'src/modules/group-log/group-log.service';
import { UserClientService } from 'src/modules/client/user/user-client.service';
import { formatValue, GROUP_FIELD_LABELS } from 'src/common/constant/constant';

@Injectable()
export class GroupService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    private readonly groupLogService: GroupLogService,
    private readonly groupCacheService: GroupCacheService,
    private readonly userClient: UserClientService,
  ) {}

  async createGroup(
    userId: string,
    dto: CreateGroupDTO,
  ): Promise<GroupResponseDTO> {
    return this.dataSource.transaction(async (manager) => {
      // Create group + default setting
      const groupRepo = manager.getRepository(Group);
      const memberRepo = manager.getRepository(GroupMember);

      const owner = await this.userClient.getUserInfo(userId);

      if (!owner) {
        throw new RpcException({
          statusCode: 404,
          message: 'Owner not found',
        });
      }

      const group = groupRepo.create({
        ...dto,
        createdBy: userId,
        owner: {
          id: owner.id,
          fullName: `${owner.firstName} ${owner.lastName}`,
          avatarUrl: owner.avatarUrl,
        },
        groupSetting: new GroupSetting(),
      });
      group.groupSetting.createdBy = userId;

      const savedGroup = await groupRepo.save(group);

      const ownerMember = memberRepo.create({
        userId,
        groupId: savedGroup.id,
        role: GroupRole.OWNER,
        group: savedGroup,
      });
      await memberRepo.save(ownerMember);

      // Outbox event
      const payload: InferGroupPayload<GroupEventType.CREATED> = {
        groupId: savedGroup.id,
        name: savedGroup.name,
        description: savedGroup.description,
        avatarUrl: savedGroup.avatarUrl,
        privacy: savedGroup.privacy,
        members: 1,
        createdAt: savedGroup.createdAt,
      };
      await this.createOutboxEvent(manager, GroupEventType.CREATED, {
        data: payload,
      });

      // Cache
      await this.groupCacheService
        .set(savedGroup.id, savedGroup)
        .catch(() => void 0);

      return plainToInstance(GroupResponseDTO, savedGroup, {
        excludeExtraneousValues: true,
      });
    });
  }

  async updateGroup(
    userId: string,
    groupId: string,
    dto: Partial<UpdateGroupDTO>,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Group);
      const group = await repo.findOne({ where: { id: groupId } });

      if (!group) {
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found',
        });
      }

      // 🔹 Build diff BEFORE update
      const changes = Object.entries(dto)
        .filter(([key, value]) => group[key] !== value)
        .map(([key, value]) => ({
          field: GROUP_FIELD_LABELS[key] ?? key,
          from: formatValue(group[key]),
          to: formatValue(value),
        }));

      // Update
      Object.assign(group, dto);
      group.updatedBy = userId;

      const updated = await repo.save(group);

      // 🔹 Log only when something actually changed
      if (changes.length > 0) {
        await this.groupLogService.log(manager, {
          groupId: updated.id,
          userId,
          eventType: GroupEventLog.GROUP_UPDATED,
          content: `Cập nhật thông tin nhóm:\n${changes
            .map((c) => `- ${c.field}: ${c.from} → ${c.to}`)
            .join('\n')}`,
        });
      }

      // Outbox event
      const payload: InferGroupPayload<GroupEventType.UPDATED> = {
        groupId: updated.id,
        name: updated.name,
        description: updated.description,
        avatarUrl: updated.avatarUrl,
        privacy: updated.privacy,
        members: updated.members,
      };

      await this.createOutboxEvent(manager, GroupEventType.UPDATED, {
        data: payload,
      });

      // Invalidate cache
      await this.groupCacheService.del(groupId).catch(() => void 0);

      return updated;
    });
  }

  async deleteGroup(userId: string, groupId: string): Promise<boolean> {
    const repo = this.groupRepo;
    const group = await repo.findOne({ where: { id: groupId } });
    if (!group)
      throw new RpcException({
        statusCode: 404,
        message: 'Group not found',
      });

    group.updatedBy = userId;
    group.status = GroupStatus.DELETED;
    await repo.save(group);

    const payload: InferGroupPayload<GroupEventType.REMOVED> = {
      groupId: group.id,
    };
    await this.createOutboxEvent(
      this.dataSource.manager,
      GroupEventType.REMOVED,
      { data: payload },
    );

    // Invalidate cache
    await this.groupCacheService.del(groupId).catch(() => void 0);

    return true;
  }

  // ---------- Private helpers ----------

  private async createOutboxEvent(
    manager: any,
    eventType: GroupEventType,
    payload: any,
  ) {
    const outboxRepo = manager.getRepository(OutboxEvent);
    const event = outboxRepo.create({
      destination: EventDestination.KAFKA,
      topic: EventTopic.GROUP_CRUD,
      eventType,
      payload: payload.data,
    });
    await outboxRepo.save(event);
  }
}
