import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { DataSource, In } from 'typeorm';
import {
  EventDestination,
  GroupEventLog,
  GroupMemberStatus,
  GroupPermission,
  GroupRole,
  InviteStatus,
  JoinRequestStatus,
  NotiOutboxPayload,
  NotiTargetType,
} from '@repo/dtos';
import { GroupInvite } from 'src/entities/group-invite.entity';
import { Group } from 'src/entities/group.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupLogService } from '../group-log/group-log.service';
import { GroupBufferService } from '../batch/buffer.service';
import { hasPermission } from 'src/common/constant/role-permission.constant';
import { GroupJoinRequest } from 'src/entities/group-join-request.entity';
import { UserClientService } from '../client/user/user-client.service';
import { OutboxEvent } from 'src/entities/outbox.entity';

@Injectable()
export class GroupInviteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly groupLogService: GroupLogService,
    private readonly groupBufferService: GroupBufferService,
    private readonly userClient: UserClientService,
  ) {}

  // ==================================================
  // 📩 INVITE USER
  // ==================================================
  async invite(groupId: string, inviterId: string, inviteeId: string) {
    return this.dataSource.transaction(async (manager) => {
      const groupRepo = manager.getRepository(Group);
      const inviteRepo = manager.getRepository(GroupInvite);
      const memberRepo = manager.getRepository(GroupMember);
      const joinRequestRepo = manager.getRepository(GroupJoinRequest);

      if (inviterId === inviteeId)
        throw new RpcException({
          statusCode: 400,
          message: 'Cannot invite yourself',
        });

      const group = await groupRepo.findOne({
        where: { id: groupId },
        relations: ['groupSetting'],
      });
      if (!group)
        throw new RpcException({ statusCode: 404, message: 'Group not found' });

      // =========================
      // PERMISSION CHECK
      // =========================
      if (!group.groupSetting.allowMemberInvite) {
        const inviterMember = await memberRepo.findOne({
          where: { groupId, userId: inviterId },
        });

        if (!inviterMember)
          throw new RpcException({
            statusCode: 403,
            message: 'Inviter is not a member',
          });

        if (
          !hasPermission(
            inviterMember.role,
            inviterMember.customPermissions,
            GroupPermission.INVITE_MEMBERS,
          )
        ) {
          throw new RpcException({
            statusCode: 403,
            message: 'No permission to invite',
          });
        }
      }

      // =========================
      // INVITEE STATE
      // =========================
      const existingMember = await memberRepo.findOne({
        where: { groupId, userId: inviteeId },
      });

      if (existingMember?.status === GroupMemberStatus.ACTIVE)
        throw new RpcException({
          statusCode: 409,
          message: 'User already a member',
        });

      if (existingMember?.status === GroupMemberStatus.BANNED)
        throw new RpcException({
          statusCode: 403,
          message: 'User is banned',
        });

      // =========================
      // AUTO-APPROVE JOIN REQUEST
      // =========================
      const joinRequest = await joinRequestRepo.findOne({
        where: {
          groupId,
          userId: inviteeId,
          status: JoinRequestStatus.PENDING,
        },
      });

      if (joinRequest) {
        await this.ensureGroupNotFull(group);

        await this.insertMember(manager, group, inviteeId);

        joinRequest.status = JoinRequestStatus.APPROVED;
        joinRequest.updatedBy = inviterId;
        await joinRequestRepo.save(joinRequest);

        await this.afterJoin(manager, group);

        await this.groupLogService.log(manager, {
          groupId,
          userId: inviterId,
          eventType: GroupEventLog.JOIN_REQUEST_APPROVED,
          content: `Join request ${joinRequest.id} approved by invite`,
        });

        await this.notify(manager, group, inviteeId, inviterId, 'request');

        return true;
      }

      // =========================
      // INVITE FLOW
      // =========================
      const existingInvite = await inviteRepo.findOne({
        where: { groupId, inviteeId, status: InviteStatus.PENDING },
      });

      if (existingInvite) {
        existingInvite.lastInviterId = inviterId;
        existingInvite.expiredAt = new Date(Date.now() + 7 * 86400000);
        await inviteRepo.save(existingInvite);
        return true;
      }

      const invite = inviteRepo.create({
        groupId,
        inviteeId,
        lastInviterId: inviterId,
        status: InviteStatus.PENDING,
      });

      await inviteRepo.save(invite);

      await this.groupLogService.log(manager, {
        groupId,
        userId: inviterId,
        eventType: GroupEventLog.INVITE_SENT,
        content: `Invited ${inviteeId} to group`,
      });

      await this.notify(manager, group, inviteeId, inviterId, 'invite');

      return true;
    });
  }

  // ==================================================
  // ✅ ACCEPT INVITE
  // ==================================================
  async acceptInvite(groupId: string, userId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inviteRepo = manager.getRepository(GroupInvite);
      const memberRepo = manager.getRepository(GroupMember);
      const groupRepo = manager.getRepository(Group);

      const invite = await inviteRepo.findOne({
        where: { groupId, inviteeId: userId, status: InviteStatus.PENDING },
      });

      if (!invite)
        throw new RpcException({
          statusCode: 404,
          message: 'Invite not found',
        });

      if (invite.expiredAt && invite.expiredAt < new Date()) {
        invite.status = InviteStatus.CANCELLED;
        await inviteRepo.save(invite);
        throw new RpcException({
          statusCode: 410,
          message: 'Invite expired',
        });
      }

      const group = await groupRepo.findOne({
        where: { id: groupId },
        relations: ['groupSetting'],
      });

      if (!group)
        throw new RpcException({ statusCode: 404, message: 'Group not found' });

      const existing = await memberRepo.findOne({
        where: { groupId, userId },
      });

      if (existing?.status === GroupMemberStatus.ACTIVE)
        throw new RpcException({
          statusCode: 409,
          message: 'Already a member',
        });

      if (existing?.status === GroupMemberStatus.BANNED)
        throw new RpcException({
          statusCode: 403,
          message: 'User is banned',
        });

      await this.ensureGroupNotFull(group);

      await this.insertMember(manager, group, userId);
      await this.afterJoin(manager, group);

      invite.status = InviteStatus.ACCEPTED;
      await inviteRepo.save(invite);

      return true;
    });
  }

  // ==================================================
  // ❌ DECLINE INVITE
  // ==================================================
  async declineInvite(groupId: string, userId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inviteRepo = manager.getRepository(GroupInvite);

      const invite = await inviteRepo.findOne({
        where: { groupId, inviteeId: userId, status: InviteStatus.PENDING },
      });

      if (!invite)
        throw new RpcException({
          statusCode: 404,
          message: 'Invite not found',
        });

      invite.status = InviteStatus.DECLINED;
      await inviteRepo.save(invite);

      return true;
    });
  }

  // ==================================================
  // 🔥 INSERT-ONLY MEMBER
  // ==================================================
  private async insertMember(
    manager,
    group: Group,
    userId: string,
  ): Promise<void> {
    const memberRepo = manager.getRepository(GroupMember);

    const member = memberRepo.create({
      groupId: group.id,
      userId,
      status: GroupMemberStatus.ACTIVE,
      role: GroupRole.MEMBER,
    });

    await memberRepo.save(member);
  }

  private async ensureGroupNotFull(group: Group) {
    if (group.members >= group.groupSetting.maxMembers)
      throw new RpcException({
        statusCode: 422,
        message: 'Group is full',
      });
  }

  private async afterJoin(manager, group: Group) {
    const groupRepo = manager.getRepository(Group);
    group.members += 1;
    await groupRepo.save(group);
    await this.groupBufferService.buffer(group.id, group.members);
  }

  // ==================================================
  // 🔔 NOTIFICATION
  // ==================================================
  private async notify(
    manager,
    group: Group,
    inviteeId: string,
    inviterId: string,
    type: 'invite' | 'request',
  ) {
    const outboxRepo = manager.getRepository(OutboxEvent);

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

    await outboxRepo.save(
      outboxRepo.create({
        destination: EventDestination.RABBITMQ,
        topic: 'notification',
        eventType,
        payload,
      }),
    );
  }
}
