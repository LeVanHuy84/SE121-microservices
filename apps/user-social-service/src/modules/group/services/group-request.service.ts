import { Inject, Injectable } from "@nestjs/common";
import { RpcException } from "@nestjs/microservices";
import {
  GroupMemberStatus,
  GroupPrivacy,
  JoinRequestResponseDTO,
  JoinRequestStatus,
  GroupEventLog,
  GroupRole,
  EventDestination,
  NotiOutboxPayload,
  NotiTargetType,
  InviteStatus,
} from "@repo/dtos";
import { plainToInstance } from "class-transformer";
import { and, eq, inArray } from "drizzle-orm";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import type { DrizzleDB } from "src/drizzle/types/drizzle.d";
import {
  groupJoinRequests,
  groupMembers,
  groupSettings,
  groups,
  groupInvites,
  outboxEvents,
} from "src/drizzle/schema/schema";
import { GroupLogService } from "./group-log.service";
import { GroupBufferService } from "./group-buffer.service";
import { UserService } from "src/modules/user/user.service";

@Injectable()
export class GroupJoinRequestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly groupLogService: GroupLogService,
    private readonly groupBufferService: GroupBufferService,
    private readonly userService: UserService,
  ) {}

  // ==================================================
  // 📨 USER REQUEST TO JOIN GROUP
  // ==================================================
  async requestToJoin(
    groupId: string,
    userId: string,
  ): Promise<{ success: boolean; response: JoinRequestResponseDTO | string }> {
    return this.db.transaction(async (tx) => {
      const group = await this.validateGroup(tx, groupId);
      await this.validateMemberStatus(tx, groupId, userId);

      // PUBLIC → auto join
      if (group.privacy === GroupPrivacy.PUBLIC) {
        await this.joinGroupInternal(tx, group, userId);
        return { success: true, response: "Joined" };
      }

      // PRIVATE / CLOSED → check invite
      const [invite] = await tx
        .select()
        .from(groupInvites)
        .where(
          and(
            eq(groupInvites.groupId, groupId),
            eq(groupInvites.inviteeId, userId),
            eq(groupInvites.status, InviteStatus.PENDING),
          ),
        )
        .limit(1);

      if (invite) {
        await this.joinGroupInternal(tx, group, userId);
        await tx
          .update(groupInvites)
          .set({ status: InviteStatus.ACCEPTED })
          .where(eq(groupInvites.id, invite.id));
        return { success: true, response: "Joined via invite" };
      }

      const joinRequest = await this.createJoinRequest(tx, groupId, userId);
      await this.createOutboxEvent(tx, joinRequest, groupId);

      return {
        success: true,
        response: plainToInstance(JoinRequestResponseDTO, joinRequest),
      };
    });
  }

  // ==================================================
  // ✅ APPROVE JOIN REQUEST
  // ==================================================
  async approveRequest(
    requestId: string,
    approverId: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [joinRequest] = await tx
        .select()
        .from(groupJoinRequests)
        .where(eq(groupJoinRequests.id, requestId))
        .limit(1);

      if (!joinRequest)
        throw new RpcException({
          statusCode: 404,
          message: "Join request not found",
        });
      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 409,
          message: "Request already processed",
        });

      const group = await this.validateGroup(tx, joinRequest.groupId);
      await this.validateMemberStatus(tx, group.id, joinRequest.userId);
      await this.joinGroupInternal(tx, group, joinRequest.userId);

      await tx
        .update(groupJoinRequests)
        .set({
          status: JoinRequestStatus.APPROVED,
          updatedBy: approverId,
          updatedAt: new Date(),
        })
        .where(eq(groupJoinRequests.id, requestId));

      const userName = await this.getUserName(joinRequest.userId);
      await this.groupLogService.log(tx, {
        groupId: group.id,
        userId: approverId,
        eventType: GroupEventLog.JOIN_REQUEST_APPROVED,
        content: `Yêu cầu vào nhóm của ${userName} được duyệt`,
      });

      return true;
    });
  }

  // ==================================================
  // ❌ REJECT JOIN REQUEST
  // ==================================================
  async rejectRequest(requestId: string, approverId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [joinRequest] = await tx
        .select()
        .from(groupJoinRequests)
        .where(eq(groupJoinRequests.id, requestId))
        .limit(1);

      if (!joinRequest)
        throw new RpcException({
          statusCode: 404,
          message: "Join request not found",
        });
      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 409,
          message: "Request already processed",
        });

      await tx
        .update(groupJoinRequests)
        .set({
          status: JoinRequestStatus.REJECTED,
          updatedBy: approverId,
          updatedAt: new Date(),
        })
        .where(eq(groupJoinRequests.id, requestId));

      const userName = await this.getUserName(joinRequest.userId);
      await this.groupLogService.log(tx, {
        groupId: joinRequest.groupId,
        userId: approverId,
        eventType: GroupEventLog.JOIN_REQUEST_REJECTED,
        content: `Yêu cầu vào nhóm của ${userName} bị từ chối`,
      });

      return true;
    });
  }

  // ==================================================
  // 🛑 CANCEL JOIN REQUEST
  // ==================================================
  async cancelRequest(requestId: string, userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [req] = await tx
        .select()
        .from(groupJoinRequests)
        .where(
          and(
            eq(groupJoinRequests.id, requestId),
            eq(groupJoinRequests.userId, userId),
          ),
        )
        .limit(1);

      if (!req)
        throw new RpcException({
          statusCode: 404,
          message: "Join request not found",
        });
      if (req.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 409,
          message: "Only pending requests can be canceled",
        });

      await tx
        .delete(groupJoinRequests)
        .where(eq(groupJoinRequests.id, req.id));

      return true;
    });
  }

  // ==================================================
  // 🔒 VALIDATIONS
  // ==================================================
  private async validateGroup(tx: any, groupId: string) {
    const [group] = await tx
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);

    if (!group)
      throw new RpcException({ statusCode: 404, message: "Group not found" });

    const [setting] = await tx
      .select()
      .from(groupSettings)
      .where(eq(groupSettings.groupId, groupId))
      .limit(1);

    if (group.members >= (setting?.maxMembers ?? 1000))
      throw new RpcException({
        statusCode: 422,
        message: "Group has reached maximum member limit",
      });

    return { ...group, groupSetting: setting };
  }

  private async validateMemberStatus(tx: any, groupId: string, userId: string) {
    const [member] = await tx
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
      )
      .limit(1);

    if (!member) return;
    if (member.status === GroupMemberStatus.ACTIVE)
      throw new RpcException({
        statusCode: 409,
        message: "User is already a member",
      });
    if (member.status === GroupMemberStatus.BANNED)
      throw new RpcException({
        statusCode: 403,
        message: "User is banned from the group",
      });
  }

  // ==================================================
  // 🔥 CORE JOIN LOGIC
  // ==================================================
  private async joinGroupInternal(tx: any, group: any, userId: string) {
    await tx.insert(groupMembers).values({
      groupId: group.id,
      userId,
      status: GroupMemberStatus.ACTIVE,
      role: GroupRole.MEMBER,
    });

    await tx
      .update(groups)
      .set({ members: group.members + 1 })
      .where(eq(groups.id, group.id));

    await this.groupBufferService.buffer(group.id, group.members + 1);
  }

  // ==================================================
  // 🔔 OUTBOX NOTIFICATION
  // ==================================================
  private async createOutboxEvent(tx: any, joinRequest: any, groupId: string) {
    const reviewers = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          inArray(groupMembers.role, [
            GroupRole.ADMIN,
            GroupRole.MODERATOR,
          ] as any[]),
        ),
      );

    if (!reviewers.length) return;

    const payload: NotiOutboxPayload = {
      requestId: joinRequest.id,
      targetId: groupId,
      targetType: NotiTargetType.GROUP,
      content: "Có yêu cầu tham gia nhóm mới",
      receivers: reviewers.map((r) => r.userId),
    };

    await tx.insert(outboxEvents).values({
      destination: EventDestination.RABBITMQ,
      topic: "notification",
      eventType: "group_noti",
      payload,
    });
  }

  // ==================================================
  // 🧹 CREATE JOIN REQUEST
  // ==================================================
  private async createJoinRequest(tx: any, groupId: string, userId: string) {
    const [existing] = await tx
      .select()
      .from(groupJoinRequests)
      .where(
        and(
          eq(groupJoinRequests.groupId, groupId),
          eq(groupJoinRequests.userId, userId),
          eq(groupJoinRequests.status, JoinRequestStatus.PENDING),
        ),
      )
      .limit(1);

    if (existing)
      throw new RpcException({
        statusCode: 409,
        message: "Join request already exists",
      });

    const [inserted] = await tx
      .insert(groupJoinRequests)
      .values({ groupId, userId, status: JoinRequestStatus.PENDING })
      .returning();

    return inserted;
  }

  private async getUserName(userId: string): Promise<string> {
    const userInfo = await this.userService.findOne(userId);
    return (
      `${userInfo?.firstName ?? ""} ${userInfo?.lastName ?? ""}`.trim() ||
      "Người dùng"
    );
  }
}
