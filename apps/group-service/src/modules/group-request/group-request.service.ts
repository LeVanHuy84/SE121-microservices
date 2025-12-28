import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
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
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { DataSource, EntityManager, In } from 'typeorm';

import { GroupJoinRequest } from 'src/entities/group-join-request.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { Group } from 'src/entities/group.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { GroupInvite } from 'src/entities/group-invite.entity';

import { GroupLogService } from '../group-log/group-log.service';
import { GroupBufferService } from '../batch/buffer.service';
import { UserClientService } from '../client/user/user-client.service';

@Injectable()
export class GroupJoinRequestService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly groupLogService: GroupLogService,
    private readonly groupBufferService: GroupBufferService,
    private readonly userClient: UserClientService,
  ) {}

  // ==================================================
  // 📨 USER REQUEST TO JOIN GROUP
  // ==================================================
  async requestToJoin(
    groupId: string,
    userId: string,
  ): Promise<{ success: boolean; response: JoinRequestResponseDTO | string }> {
    return this.dataSource.transaction(async (manager) => {
      const group = await this.validateGroup(manager, groupId);
      await this.validateMemberStatus(manager, groupId, userId);

      // PUBLIC → auto join
      if (group.privacy === GroupPrivacy.PUBLIC) {
        await this.joinGroupInternal(manager, group, userId);
        return { success: true, response: 'Joined' };
      }

      // PRIVATE / CLOSED → check invite
      const invite = await manager.findOne(GroupInvite, {
        where: {
          groupId,
          inviteeId: userId,
          status: InviteStatus.PENDING,
        },
      });

      if (invite) {
        await this.joinGroupInternal(manager, group, userId);
        invite.status = InviteStatus.ACCEPTED;
        await manager.save(invite);
        return { success: true, response: 'Joined via invite' };
      }

      const joinRequest = await this.createJoinRequest(
        manager,
        groupId,
        userId,
      );

      await this.createOutboxEvent(manager, joinRequest, groupId);

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
    return this.dataSource.transaction(async (manager) => {
      const joinRequest = await manager.findOne(GroupJoinRequest, {
        where: { id: requestId },
      });

      if (!joinRequest)
        throw new RpcException({
          statusCode: 404,
          message: 'Join request not found',
        });

      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 409,
          message: 'Request already processed',
        });

      const group = await manager.findOne(Group, {
        where: { id: joinRequest.groupId },
        relations: ['groupSetting'],
      });

      if (!group)
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found',
        });
      await this.validateMemberStatus(manager, group.id, joinRequest.userId);
      await this.joinGroupInternal(manager, group, joinRequest.userId);

      joinRequest.status = JoinRequestStatus.APPROVED;
      joinRequest.updatedBy = approverId;
      await manager.save(joinRequest);

      const userName = await this.getUserName(joinRequest.userId);

      await await this.groupLogService.log(manager, {
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
    return this.dataSource.transaction(async (manager) => {
      const joinRequest = await manager.findOne(GroupJoinRequest, {
        where: { id: requestId },
      });

      if (!joinRequest)
        throw new RpcException({
          statusCode: 404,
          message: 'Join request not found',
        });

      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 409,
          message: 'Request already processed',
        });

      joinRequest.status = JoinRequestStatus.REJECTED;
      joinRequest.updatedBy = approverId;
      await manager.save(joinRequest);

      const userName = await this.getUserName(joinRequest.userId);

      await this.groupLogService.log(manager, {
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
    return this.dataSource.transaction(async (manager) => {
      const req = await manager.findOne(GroupJoinRequest, {
        where: { id: requestId, userId },
      });

      if (!req)
        throw new RpcException({
          statusCode: 404,
          message: 'Join request not found',
        });

      if (req.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 409,
          message: 'Only pending requests can be canceled',
        });

      await manager.remove(req);
      return true;
    });
  }

  // ==================================================
  // 🔒 VALIDATIONS
  // ==================================================
  private async validateGroup(manager: EntityManager, groupId: string) {
    const group = await manager.findOne(Group, {
      where: { id: groupId },
      relations: ['groupSetting'],
    });

    if (!group)
      throw new RpcException({
        statusCode: 404,
        message: 'Group not found',
      });

    if (group.members >= group.groupSetting.maxMembers)
      throw new RpcException({
        statusCode: 422,
        message: 'Group has reached maximum member limit',
      });

    return group;
  }

  private async validateMemberStatus(
    manager: EntityManager,
    groupId: string,
    userId: string,
  ) {
    const member = await manager.findOne(GroupMember, {
      where: { groupId, userId },
    });

    if (!member) return;

    if (member.status === GroupMemberStatus.ACTIVE)
      throw new RpcException({
        statusCode: 409,
        message: 'User is already a member',
      });

    if (member.status === GroupMemberStatus.BANNED)
      throw new RpcException({
        statusCode: 403,
        message: 'User is banned from the group',
      });
  }

  // ==================================================
  // 🔥 CORE JOIN LOGIC (INSERT ONLY)
  // ==================================================
  private async joinGroupInternal(
    manager: EntityManager,
    group: Group,
    userId: string,
  ) {
    const memberRepo = manager.getRepository(GroupMember);
    const groupRepo = manager.getRepository(Group);

    const member = memberRepo.create({
      groupId: group.id,
      userId,
      status: GroupMemberStatus.ACTIVE,
      role: GroupRole.MEMBER,
    });

    await memberRepo.save(member);

    group.members += 1;
    await groupRepo.save(group);

    await this.groupBufferService.buffer(group.id, group.members);
  }

  // ==================================================
  // 🔔 OUTBOX NOTIFICATION
  // ==================================================
  private async createOutboxEvent(
    manager: EntityManager,
    joinRequest: GroupJoinRequest,
    groupId: string,
  ) {
    const memberRepo = manager.getRepository(GroupMember);
    const outboxRepo = manager.getRepository(OutboxEvent);

    const reviewers = await memberRepo.find({
      where: {
        groupId,
        role: In([GroupRole.ADMIN, GroupRole.MODERATOR]),
      },
      select: ['userId'],
    });

    if (!reviewers.length) return;

    const payload: NotiOutboxPayload = {
      requestId: joinRequest.id,
      targetId: groupId,
      targetType: NotiTargetType.GROUP,
      content: 'Có yêu cầu tham gia nhóm mới',
      receivers: reviewers.map((r) => r.userId),
    };

    const event = outboxRepo.create({
      destination: EventDestination.RABBITMQ,
      topic: 'notification',
      eventType: 'group_noti',
      payload,
    });

    await outboxRepo.save(event);
  }

  // ==================================================
  // 🧹 CREATE JOIN REQUEST
  // ==================================================
  private async createJoinRequest(
    manager: EntityManager,
    groupId: string,
    userId: string,
  ) {
    const repo = manager.getRepository(GroupJoinRequest);

    const existing = await repo.findOne({
      where: { groupId, userId, status: JoinRequestStatus.PENDING },
    });

    if (existing)
      throw new RpcException({
        statusCode: 409,
        message: 'Join request already exists',
      });

    return repo.save(
      repo.create({
        groupId,
        userId,
        status: JoinRequestStatus.PENDING,
      }),
    );
  }

  private async getUserName(userId: string): Promise<string> {
    const userInfo = await this.userClient.getUserInfo(userId);
    const userName =
      `${userInfo?.firstName ?? ''} ${userInfo?.lastName ?? ''}`.trim() ||
      'Người dùng';
    return userName;
  }
}
