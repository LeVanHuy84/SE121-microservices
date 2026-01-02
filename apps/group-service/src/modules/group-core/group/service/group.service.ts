import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
  MediaDeleteItem,
  MediaEventPayloads,
  MediaEventType,
  MediaItemDTO,
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
import { GroupMapper } from 'src/common/mapper/group.mapper';

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

  // ==================================================
  // =================== CREATE =======================
  async createGroup(
    userId: string,
    dto: CreateGroupDTO,
  ): Promise<GroupResponseDTO> {
    return this.dataSource.transaction(async (manager) => {
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
        groupSetting: Object.assign(new GroupSetting(), {
          createdBy: userId,
        }),
      });

      const saved = await groupRepo.save(group);

      await memberRepo.save(
        memberRepo.create({
          userId,
          groupId: saved.id,
          role: GroupRole.OWNER,
        }),
      );

      // 🔹 Media assign
      await this.emitMediaAssign(manager, saved.id, [
        saved.avatar,
        saved.coverImage,
      ]);

      // 🔹 Group created event
      await this.emitGroupEvent(manager, GroupEventType.CREATED, {
        groupId: saved.id,
        name: saved.name,
        description: saved.description,
        avatarUrl: saved.avatar?.url,
        privacy: saved.privacy,
        members: 1,
        createdAt: saved.createdAt,
      });

      await this.groupCacheService.set(saved.id, saved).catch(() => void 0);

      return GroupMapper.toGroupResponseDTO(saved);
    });
  }

  // ==================================================
  // =================== UPDATE =======================
  async updateGroup(
    userId: string,
    groupId: string,
    dto: Partial<UpdateGroupDTO>,
  ) {
    return this.dataSource
      .transaction(async (manager) => {
        const repo = manager.getRepository(Group);
        const group = await repo.findOne({ where: { id: groupId } });

        if (!group) {
          throw new RpcException({
            statusCode: 404,
            message: 'Group not found',
          });
        }

        const before = {
          avatar: group.avatar,
          coverImage: group.coverImage,
        };

        // 🔹 Build diff log
        const changes = Object.entries(dto)
          .filter(([k, v]) => group[k] !== v)
          .map(([k, v]) => ({
            field: GROUP_FIELD_LABELS[k] ?? k,
            from: formatValue(group[k]),
            to: formatValue(v),
          }));

        Object.assign(group, dto);
        group.updatedBy = userId;

        const updated = await repo.save(group);

        // 🔹 Log
        if (changes.length) {
          await this.groupLogService.log(manager, {
            groupId: updated.id,
            userId,
            eventType: GroupEventLog.GROUP_UPDATED,
            content: `Cập nhật thông tin nhóm:\n${changes
              .map((c) => `- ${c.field}: ${c.from} → ${c.to}`)
              .join('\n')}`,
          });
        }

        // 🔹 Media diff
        await this.diffAndEmitMedia(manager, updated.id, before, updated);

        // 🔹 Event
        await this.emitGroupEvent(manager, GroupEventType.UPDATED, {
          groupId: updated.id,
          name: updated.name,
          description: updated.description,
          avatarUrl: updated.avatar?.url,
          privacy: updated.privacy,
          members: updated.members,
        });

        return updated;
      })
      .finally(() => {
        this.groupCacheService.del(groupId).catch(() => void 0);
      });
  }

  // ==================================================
  // =================== DELETE =======================
  async deleteGroup(userId: string, groupId: string): Promise<boolean> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Group);
      const group = await repo.findOne({ where: { id: groupId } });

      if (!group) {
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found',
        });
      }

      group.status = GroupStatus.DELETED;
      group.updatedBy = userId;
      await repo.save(group);

      // 🔹 Media delete
      await this.emitMediaDelete(manager, [group.avatar, group.coverImage]);

      await this.emitGroupEvent(manager, GroupEventType.REMOVED, {
        groupId: group.id,
      });
    });

    await this.groupCacheService.del(groupId).catch(() => void 0);
    return true;
  }

  // ==================================================
  // ================== MEDIA CORE ====================
  private async emitMediaAssign(
    manager: EntityManager,
    contentId: string,
    medias: ({ publicId?: string; url?: string } | undefined)[],
  ) {
    const items = medias
      .filter((m): m is { publicId: string; url?: string } => !!m?.publicId)
      .map((m) => ({
        publicId: m.publicId,
        type: 'image' as const,
        url: m.url,
      }));

    if (!items.length) return;

    const payload: MediaEventPayloads[MediaEventType.CONTENT_ID_ASSIGNED] = {
      contentId,
      items,
    };

    await manager.save(
      manager.create(OutboxEvent, {
        topic: EventTopic.MEDIA,
        destination: EventDestination.KAFKA,
        eventType: MediaEventType.CONTENT_ID_ASSIGNED,
        payload,
      }),
    );
  }

  private async emitMediaDelete(
    manager: EntityManager,
    medias: ({ publicId?: string } | undefined)[],
  ) {
    const items: MediaDeleteItem[] = medias
      .filter((m): m is { publicId: string } => !!m?.publicId)
      .map((m) => ({
        publicId: m.publicId,
        resourceType: 'image',
      }));

    if (!items.length) return;

    const payload: MediaEventPayloads[MediaEventType.DELETE_REQUESTED] = {
      items,
    };

    await manager.save(
      manager.create(OutboxEvent, {
        topic: EventTopic.MEDIA,
        destination: EventDestination.KAFKA,
        eventType: MediaEventType.DELETE_REQUESTED,
        payload,
      }),
    );
  }

  private async diffAndEmitMedia(
    manager: EntityManager,
    contentId: string,
    before: {
      avatar?: MediaItemDTO;
      coverImage?: MediaItemDTO;
    },
    after: {
      avatar?: MediaItemDTO;
      coverImage?: MediaItemDTO;
    },
  ) {
    const toDelete: MediaItemDTO[] = [];
    const toAssign: MediaItemDTO[] = [];

    if (before.avatar?.publicId !== after.avatar?.publicId) {
      if (before.avatar?.publicId) {
        toDelete.push(before.avatar);
      }
      if (after.avatar?.publicId) {
        toAssign.push(after.avatar);
      }
    }

    if (before.coverImage?.publicId !== after.coverImage?.publicId) {
      if (before.coverImage?.publicId) {
        toDelete.push(before.coverImage);
      }
      if (after.coverImage?.publicId) {
        toAssign.push(after.coverImage);
      }
    }

    await this.emitMediaDelete(manager, toDelete);
    await this.emitMediaAssign(manager, contentId, toAssign);
  }

  // ==================================================
  // ================== GROUP EVENT ===================
  private async emitGroupEvent(
    manager: EntityManager,
    type: GroupEventType,
    payload: InferGroupPayload<any>,
  ) {
    await manager.save(
      manager.create(OutboxEvent, {
        topic: EventTopic.GROUP_CRUD,
        destination: EventDestination.KAFKA,
        eventType: type,
        payload,
      }),
    );
  }
}
