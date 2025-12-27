import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
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
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupJoinRequest } from 'src/entities/group-join-request.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { Group } from 'src/entities/group.entity';
import { DataSource, In } from 'typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { GroupLogService } from '../group-log/group-log.service';
import { GroupBufferService } from '../batch/buffer.service';

@Injectable()
export class GroupJoinRequestService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GroupJoinRequest)
    private readonly groupLogService: GroupLogService,
    private readonly groupBufferService: GroupBufferService,
  ) {}

  // 📨 User gửi yêu cầu tham gia nhóm
  async requestToJoin(
    groupId: string,
    userId: string,
  ): Promise<{ success: boolean; response: JoinRequestResponseDTO | string }> {
    return this.dataSource.transaction(async (manager) => {
      const group = await this.validateGroup(manager, groupId);
      await this.validateMemberStatus(manager, groupId, userId, group);

      if (group.privacy === GroupPrivacy.PUBLIC) {
        return this.autoJoinPublicGroup(manager, group, userId);
      }

      const joinRequest = await this.createJoinRequest(
        manager,
        groupId,
        userId,
      );
      await this.createOutboxEvent(manager, joinRequest, groupId, userId);

      return {
        success: true,
        response: plainToInstance(JoinRequestResponseDTO, joinRequest),
      };
    });
  }

  // ✅ Duyệt yêu cầu tham gia
  async approveRequest(
    requestId: string,
    approverId: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const groupRepo = manager.getRepository(Group);
      const memberRepo = manager.getRepository(GroupMember);
      const joinRequestRepo = manager.getRepository(GroupJoinRequest);

      const joinRequest = await joinRequestRepo.findOne({
        where: { id: requestId },
      });
      if (!joinRequest)
        throw new RpcException({
          statusCode: 404,
          message: 'Join request not found',
        });
      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 404,
          message: 'Request already processed',
        });

      const group = await groupRepo.findOne({
        where: { id: joinRequest.groupId },
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

      const member = await memberRepo.findOne({
        where: {
          groupId: joinRequest.groupId,
          userId: joinRequest.userId,
        },
      });

      if (member) {
        member.role = GroupRole.MEMBER;
        member.customPermissions = [];
        member.status = GroupMemberStatus.ACTIVE;
        await memberRepo.save(member);
      } else {
        const newMember = memberRepo.create({
          groupId: joinRequest.groupId,
          userId: joinRequest.userId,
          status: GroupMemberStatus.ACTIVE,
        });
        await memberRepo.save(newMember);
      }

      group.members += 1;
      const savedGroup = await groupRepo.save(group);

      joinRequest.status = JoinRequestStatus.APPROVED;
      joinRequest.updatedBy = approverId;
      await joinRequestRepo.save(joinRequest);

      await this.groupLogService.log(manager, {
        groupId: joinRequest.groupId,
        userId: approverId,
        eventType: GroupEventLog.JOIN_REQUEST_APPROVED,
        content: `Join request with id: ${joinRequest.id} approved by: ${approverId}`,
      });

      await this.groupBufferService.buffer(savedGroup.id, savedGroup.members);

      return true;
    });
  }

  // ❌ Từ chối yêu cầu
  async rejectRequest(requestId: string, approverId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const joinRequestRepo = manager.getRepository(GroupJoinRequest);

      const joinRequest = await joinRequestRepo.findOne({
        where: { id: requestId },
      });
      if (!joinRequest)
        throw new RpcException({
          statusCode: 404,
          message: 'Join request not found',
        });
      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 404,
          message: 'Request already processed',
        });

      joinRequest.status = JoinRequestStatus.REJECTED;
      joinRequest.updatedBy = approverId;
      await joinRequestRepo.save(joinRequest);

      await this.groupLogService.log(manager, {
        groupId: joinRequest.groupId,
        userId: approverId,
        eventType: GroupEventLog.JOIN_REQUEST_REJECTED,
        content: `Join request with id: ${joinRequest.id} rejected by: ${approverId}`,
      });

      return true;
    });
  }

  // 🛑 Hủy yêu cầu tham gia nhóm
  async cancelRequest(requestId: string, userId: string): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const joinRequestRepo = manager.getRepository(GroupJoinRequest);
      const joinRequest = await joinRequestRepo.findOne({
        where: { id: requestId, userId },
      });
      if (!joinRequest)
        throw new RpcException({
          statusCode: 404,
          message: 'Join request not found',
        });
      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException({
          statusCode: 404,
          message: 'Only pending requests can be canceled',
        });
      await joinRequestRepo.remove(joinRequest);
      return true;
    });
  }

  // Helper methods
  private async validateGroup(manager, groupId: string) {
    const groupRepo = manager.getRepository(Group);

    const group = await groupRepo.findOne({
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
    manager,
    groupId: string,
    userId: string,
    group: Group,
  ) {
    const memberRepo = manager.getRepository(GroupMember);

    const member = await memberRepo.findOne({ where: { groupId, userId } });

    if (!member) return;

    if (member.status === GroupMemberStatus.ACTIVE)
      throw new RpcException({
        statusCode: 409,
        message: 'User is already a member of the group',
      });

    if (member.status === GroupMemberStatus.BANNED)
      throw new RpcException({
        statusCode: 403,
        message: 'User is banned from the group',
      });
  }

  private async autoJoinPublicGroup(manager, group: Group, userId: string) {
    const memberRepo = manager.getRepository(GroupMember);
    const groupRepo = manager.getRepository(Group);

    let member = await memberRepo.findOne({
      where: { groupId: group.id, userId },
    });

    if (member) {
      member.role = GroupRole.MEMBER;
      member.customPermissions = [];
      member.status = GroupMemberStatus.ACTIVE;
    } else {
      member = memberRepo.create({
        groupId: group.id,
        userId,
        status: GroupMemberStatus.ACTIVE,
      });
    }

    await memberRepo.save(member);

    group.members += 1;
    const savedGroup = await groupRepo.save(group);

    await this.groupBufferService.buffer(savedGroup.id, savedGroup.members);

    return { success: true, response: 'Joined' };
  }

  private async createJoinRequest(manager, groupId: string, userId: string) {
    const joinRequestRepo = manager.getRepository(GroupJoinRequest);

    const existing = await joinRequestRepo.findOne({
      where: { groupId, userId, status: JoinRequestStatus.PENDING },
    });

    if (existing)
      throw new RpcException({
        statusCode: 409,
        message: 'User already has a pending join request',
      });

    const req = joinRequestRepo.create({
      groupId,
      userId,
      status: JoinRequestStatus.PENDING,
    });

    return joinRequestRepo.save(req);
  }

  private async createOutboxEvent(manager, joinRequest, groupId, userId) {
    const memberRepo = manager.getRepository(GroupMember);
    const outboxRepo = manager.getRepository(OutboxEvent);

    const reviewers = await memberRepo.find({
      where: {
        groupId,
        role: In([GroupRole.ADMIN, GroupRole.MODERATOR]),
      },
      select: ['userId'],
    });

    const payload: NotiOutboxPayload = {
      requestId: joinRequest.id,
      targetId: groupId,
      targetType: NotiTargetType.GROUP,
      content: 'Có yêu cầu vào nhóm mới',
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
}
