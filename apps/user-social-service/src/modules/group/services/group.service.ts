import { Inject, Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import {
  ActivityType,
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
  MediaType,
  UpdateGroupDTO,
} from "@repo/dtos";
import {
  formatValue,
  GROUP_FIELD_LABELS,
} from "src/modules/group/common/constant/constant";
import { GroupMapper } from "src/modules/group/common/mapper/group.mapper";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import type { DrizzleDB } from "src/drizzle/types/drizzle.d";
import {
  groups,
  groupMembers,
  groupSettings,
  outboxEvents,
  Group,
} from "src/drizzle/schema/schema";
import { eq, sql } from "drizzle-orm";
import { UserService } from "src/modules/user/user.service";
import { GroupLogService } from "src/modules/group/services/group-log.service";
import { GroupCacheService } from "./group-cache.service";

@Injectable()
export class GroupService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly groupLogService: GroupLogService,
    private readonly groupCacheService: GroupCacheService,
    private readonly userService: UserService,
  ) {}

  // ==================================================
  // =================== CREATE =======================
  async createGroup(
    userId: string,
    dto: CreateGroupDTO,
  ): Promise<GroupResponseDTO> {
    const owner = await this.userService.findOne(userId);
    if (!owner) {
      throw new RpcException({
        statusCode: 404,
        message: "Owner not found",
      });
    }

    return this.db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(groups)
        .values({
          ...dto,
          createdBy: userId,
          owner: {
            id: owner.id,
            fullName: `${owner.firstName} ${owner.lastName}`,
            avatarUrl: owner.avatarUrl,
          },
        })
        .returning();

      // Insert group setting
      await tx.insert(groupSettings).values({
        groupId: saved.id,
        createdBy: userId,
      });

      // Insert owner as member
      await tx.insert(groupMembers).values({
        userId,
        groupId: saved.id,
        role: GroupRole.OWNER,
      });

      // 🔹 Media assign
      await this.emitMediaAssign(tx, saved.id, [
        saved.avatar,
        saved.coverImage,
      ]);

      // 🔹 Group created event
      await this.emitGroupEvent(tx, GroupEventType.CREATED, {
        groupId: saved.id,
        name: saved.name,
        description: saved.description,
        avatarUrl: saved.avatar?.url,
        privacy: saved.privacy,
        members: 1,
        createdAt: saved.createdAt,
      });

      // 🔹 User activity log outbox
      await tx.insert(outboxEvents).values({
        destination: EventDestination.RABBITMQ,
        topic: EventTopic.USER_ACTIVITY_LOG,
        eventType: ActivityType.GROUP_CREATED,
        payload: {
          actorId: userId,
          activityType: ActivityType.GROUP_CREATED,
          targetId: saved.id,
          contentPreview: `Bạn đã tạo nhóm ${saved.name}`,
          createdAt: saved.createdAt,
        },
      });

      await this.groupCacheService
        .set(saved.id, saved as any)
        .catch(() => void 0);

      return GroupMapper.toGroupResponseDTO(saved as any);
    });
  }

  // ==================================================
  // =================== UPDATE =======================
  async updateGroup(
    userId: string,
    groupId: string,
    dto: Partial<UpdateGroupDTO>,
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        const [group] = await tx
          .select()
          .from(groups)
          .where(eq(groups.id, groupId))
          .limit(1);

        if (!group) {
          throw new RpcException({
            statusCode: 404,
            message: "Group not found",
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

        const [updated] = await tx
          .update(groups)
          .set({ ...dto, updatedBy: userId, updatedAt: new Date() })
          .where(eq(groups.id, groupId))
          .returning();

        // 🔹 Log
        if (changes.length) {
          await this.groupLogService.log(tx, {
            groupId: updated.id,
            userId,
            eventType: GroupEventLog.GROUP_UPDATED,
            content: `Cập nhật thông tin nhóm:\n${changes
              .map((c) => `- ${c.field}: ${c.from} → ${c.to}`)
              .join("\n")}`,
          });
        }

        // 🔹 Media diff
        await this.diffAndEmitMedia(
          tx,
          updated.id,
          before as any,
          updated as any,
        );

        // 🔹 Event
        await this.emitGroupEvent(tx, GroupEventType.UPDATED, {
          groupId: updated.id,
          name: updated.name,
          description: updated.description,
          avatarUrl: updated.avatar?.url,
          privacy: updated.privacy,
          members: updated.members,
        });

        return updated;
      });
    } finally {
      this.groupCacheService.del(groupId).catch(() => void 0);
    }
  }

  // ==================================================
  // =================== DELETE =======================
  async deleteGroup(userId: string, groupId: string): Promise<boolean> {
    await this.db.transaction(async (tx) => {
      const [group] = await tx
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      if (!group) {
        throw new RpcException({
          statusCode: 404,
          message: "Group not found",
        });
      }

      await tx
        .update(groups)
        .set({
          status: GroupStatus.DELETED,
          updatedBy: userId,
          updatedAt: new Date(),
        })
        .where(eq(groups.id, groupId));

      // 🔹 Media delete
      await this.emitMediaDelete(tx, [group.avatar, group.coverImage] as any);

      await this.emitGroupEvent(tx, GroupEventType.REMOVED, {
        groupId: group.id,
      });
    });

    await this.groupCacheService.del(groupId).catch(() => void 0);
    return true;
  }

  // ==================================================
  // ================== MEDIA CORE ====================
  private async emitMediaAssign(
    tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0],
    contentId: string,
    medias: ({ publicId?: string; url?: string } | undefined | null)[],
  ) {
    const items = medias
      .filter((m): m is { publicId: string; url?: string } => !!m?.publicId)
      .map((m) => ({
        publicId: m.publicId,
        type: MediaType.IMAGE,
        url: m.url,
      }));

    if (!items.length) return;

    const payload: MediaEventPayloads[MediaEventType.CONTENT_ID_ASSIGNED] = {
      contentId,
      items,
    };

    await tx.insert(outboxEvents).values({
      topic: EventTopic.MEDIA,
      destination: EventDestination.KAFKA,
      eventType: MediaEventType.CONTENT_ID_ASSIGNED,
      payload,
    });
  }

  private async emitMediaDelete(
    tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0],
    medias: ({ publicId?: string } | undefined | null)[],
  ) {
    const items: MediaDeleteItem[] = medias
      .filter((m): m is { publicId: string } => !!m?.publicId)
      .map((m) => ({
        publicId: m.publicId,
        resourceType: "image",
      }));

    if (!items.length) return;

    const payload: MediaEventPayloads[MediaEventType.DELETE_REQUESTED] = {
      items,
    };

    await tx.insert(outboxEvents).values({
      topic: EventTopic.MEDIA,
      destination: EventDestination.KAFKA,
      eventType: MediaEventType.DELETE_REQUESTED,
      payload,
    });
  }

  private async diffAndEmitMedia(
    tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0],
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
      if (before.avatar?.publicId) toDelete.push(before.avatar);
      if (after.avatar?.publicId) toAssign.push(after.avatar);
    }

    if (before.coverImage?.publicId !== after.coverImage?.publicId) {
      if (before.coverImage?.publicId) toDelete.push(before.coverImage);
      if (after.coverImage?.publicId) toAssign.push(after.coverImage);
    }

    await this.emitMediaDelete(tx, toDelete);
    await this.emitMediaAssign(tx, contentId, toAssign);
  }

  // ==================================================
  // ================== GROUP EVENT ===================
  private async emitGroupEvent(
    tx: Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0],
    type: GroupEventType,
    payload: InferGroupPayload<any>,
  ) {
    await tx.insert(outboxEvents).values({
      topic: EventTopic.GROUP_CRUD,
      destination: EventDestination.KAFKA,
      eventType: type,
      payload,
    });
  }
}
