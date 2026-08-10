import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  ActivityType,
  EventDestination,
  EventTopic,
  GroupEventLog,
  GroupMemberStatus,
  GroupPermission,
  GroupRole,
  InviteStatus,
  JoinRequestStatus,
  NotiOutboxPayload,
  NotiTargetType,
} from '@repo/dtos';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import {
  groupInvites,
  groupJoinRequests,
  groupMembers,
  groupSettings,
  groups,
  outboxEvents,
} from 'src/drizzle/schema/schema';
import { GroupLogService } from './group-log.service';
import { GroupBufferService } from './group-buffer.service';
import { hasPermission } from 'src/modules/group/common/constant/role-permission.constant';
import { UserClientService } from './user-client.service';

@Injectable()
export class GroupInviteService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly groupLogService: GroupLogService,
    private readonly groupBufferService: GroupBufferService,
    private readonly userClient: UserClientService,
  ) {}

  // ==================================================
  // 📩 INVITE USER
  // ==================================================
  async invite(groupId: string, inviterId: string, inviteeId: string) {
    return this.db.transaction(async (tx) => {
      if (inviterId === inviteeId)
        throw new RpcException({ statusCode: 400, message: 'Cannot invite yourself' });

      const [group] = await tx
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      if (!group)
        throw new RpcException({ statusCode: 404, message: 'Group not found' });

      const [setting] = await tx
        .select()
        .from(groupSettings)
        .where(eq(groupSettings.groupId, groupId))
        .limit(1);

      // PERMISSION CHECK
      if (!setting?.allowMemberInvite) {
        const [inviterMember] = await tx
          .select()
          .from(groupMembers)
          .where(
            and(
              eq(groupMembers.groupId, groupId),
              eq(groupMembers.userId, inviterId),
            ),
          )
          .limit(1);

        if (!inviterMember)
          throw new RpcException({ statusCode: 403, message: 'Inviter is not a member' });

        if (
          !hasPermission(
            inviterMember.role as GroupRole,
            inviterMember.customPermissions as GroupPermission[],
            GroupPermission.INVITE_MEMBERS,
          )
        )
          throw new RpcException({ statusCode: 403, message: 'No permission to invite' });
      }

      // INVITEE STATE CHECK
      const [existingMember] = await tx
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.userId, inviteeId),
          ),
        )
        .limit(1);

      if (existingMember?.status === GroupMemberStatus.ACTIVE)
        throw new RpcException({ statusCode: 409, message: 'User already a member' });
      if (existingMember?.status === GroupMemberStatus.BANNED)
        throw new RpcException({ statusCode: 403, message: 'User is banned' });

      // AUTO-APPROVE JOIN REQUEST
      const [joinRequest] = await tx
        .select()
        .from(groupJoinRequests)
        .where(
          and(
            eq(groupJoinRequests.groupId, groupId),
            eq(groupJoinRequests.userId, inviteeId),
            eq(groupJoinRequests.status, JoinRequestStatus.PENDING),
          ),
        )
        .limit(1);

      const invitee = await this.userClient.getUserInfo(inviteeId);
      const inviteeName =
        `${invitee?.firstName ?? ''} ${invitee?.lastName ?? ''}`.trim() ||
        'Người dùng';

      if (joinRequest) {
        await this.ensureGroupNotFull(group, setting);
        await this.insertMember(tx, group, inviteeId);

        await tx
          .update(groupJoinRequests)
          .set({ status: JoinRequestStatus.APPROVED, updatedBy: inviterId, updatedAt: new Date() })
          .where(eq(groupJoinRequests.id, joinRequest.id));

        await this.afterJoin(tx, group);

        await this.groupLogService.log(tx, {
          groupId,
          userId: inviterId,
          eventType: GroupEventLog.JOIN_REQUEST_APPROVED,
          content: `Yêu cầu vào nhóm của ${inviteeName} được chấp thuận bởi lời mời`,
        });

        await this.notify(tx, group, setting, inviteeId, inviterId, 'request');
        return true;
      }

      // INVITE FLOW
      const [existingInvite] = await tx
        .select()
        .from(groupInvites)
        .where(
          and(
            eq(groupInvites.groupId, groupId),
            eq(groupInvites.inviteeId, inviteeId),
            eq(groupInvites.status, InviteStatus.PENDING),
          ),
        )
        .limit(1);

      if (existingInvite) {
        const currentInviters = existingInvite.inviters ?? [];
        if (!currentInviters.includes(inviterId)) {
          currentInviters.push(inviterId);
        }
        await tx
          .update(groupInvites)
          .set({
            inviters: currentInviters,
            expiredAt: new Date(Date.now() + 7 * 86400000),
          })
          .where(eq(groupInvites.id, existingInvite.id));
        return true;
      }

      await tx.insert(groupInvites).values({
        groupId,
        inviteeId,
        inviters: [inviterId],
        status: InviteStatus.PENDING,
      });

      await this.groupLogService.log(tx, {
        groupId,
        userId: inviterId,
        eventType: GroupEventLog.INVITE_SENT,
        content: `Đã mời ${inviteeName} vào nhóm`,
      });

      await this.notify(tx, group, setting, inviteeId, inviterId, 'invite');
      return true;
    });
  }

  // ==================================================
  // ✅ ACCEPT INVITE
  // ==================================================
  async acceptInvite(groupId: string, userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
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

      if (!invite)
        throw new RpcException({ statusCode: 404, message: 'Invite not found' });

      if (invite.expiredAt && invite.expiredAt < new Date()) {
        await tx
          .update(groupInvites)
          .set({ status: InviteStatus.CANCELLED })
          .where(eq(groupInvites.id, invite.id));
        throw new RpcException({ statusCode: 410, message: 'Invite expired' });
      }

      const [group] = await tx
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);
      if (!group)
        throw new RpcException({ statusCode: 404, message: 'Group not found' });

      const [setting] = await tx
        .select()
        .from(groupSettings)
        .where(eq(groupSettings.groupId, groupId))
        .limit(1);

      const [existing] = await tx
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupId, groupId),
            eq(groupMembers.userId, userId),
          ),
        )
        .limit(1);

      if (existing?.status === GroupMemberStatus.ACTIVE)
        throw new RpcException({ statusCode: 409, message: 'Already a member' });
      if (existing?.status === GroupMemberStatus.BANNED)
        throw new RpcException({ statusCode: 403, message: 'User is banned' });

      await this.ensureGroupNotFull(group, setting);
      await this.insertMember(tx, group, userId);
      await this.afterJoin(tx, group);

      await tx
        .update(groupInvites)
        .set({ status: InviteStatus.ACCEPTED })
        .where(eq(groupInvites.id, invite.id));

      await tx.insert(outboxEvents).values({
        destination: EventDestination.RABBITMQ,
        topic: EventTopic.USER_ACTIVITY_LOG,
        eventType: ActivityType.GROUP_JOINED,
        payload: {
          actorId: userId,
          activityType: ActivityType.GROUP_JOINED,
          targetId: group.id,
          contentPreview: `Đã tham gia nhóm ${group.name}`,
          createdAt: group.createdAt,
        },
      });

      return true;
    });
  }

  // ==================================================
  // DECLINE INVITE
  // ==================================================
  async declineInvite(groupId: string, userId: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
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

      if (!invite)
        throw new RpcException({ statusCode: 404, message: 'Invite not found' });

      await tx
        .update(groupInvites)
        .set({ status: InviteStatus.DECLINED })
        .where(eq(groupInvites.id, invite.id));

      return true;
    });
  }

  // ==================================================
  // 🔥 PRIVATE HELPERS
  // ==================================================
  private async insertMember(tx: any, group: any, userId: string) {
    await tx.insert(groupMembers).values({
      groupId: group.id,
      userId,
      status: GroupMemberStatus.ACTIVE,
      role: GroupRole.MEMBER,
    });
  }

  private async ensureGroupNotFull(group: any, setting: any) {
    if (group.members >= (setting?.maxMembers ?? 1000))
      throw new RpcException({ statusCode: 422, message: 'Group is full' });
  }

  private async afterJoin(tx: any, group: any) {
    await tx
      .update(groups)
      .set({ members: group.members + 1 })
      .where(eq(groups.id, group.id));
    await this.groupBufferService.buffer(group.id, group.members + 1);
  }

  private async notify(
    tx: any,
    group: any,
    setting: any,
    inviteeId: string,
    inviterId: string,
    type: 'invite' | 'request',
  ) {
    let payload: NotiOutboxPayload;
    let eventType: string;

    if (type === 'invite') {
      const inviter = await this.userClient.getUserInfo(inviterId);
      payload = {
        targetId: group.id,
        targetType: NotiTargetType.GROUP,
        content: `${inviter?.firstName} ${inviter?.lastName} đã mời bạn tham gia nhóm ${group.name}`,
        receivers: [inviteeId],
      };
      eventType = 'group_invite';
    } else {
      payload = {
        targetId: group.id,
        targetType: NotiTargetType.GROUP,
        content: `Yêu cầu tham gia nhóm ${group.name} của bạn đã được duyệt`,
        receivers: [inviteeId],
      };
      eventType = 'join_request_approved';
    }

    await tx.insert(outboxEvents).values({
      destination: EventDestination.RABBITMQ,
      topic: 'notification',
      eventType,
      payload,
    });
  }
}
