import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CursorPageResponse,
  GroupMemberStatus,
  GroupPrivacy,
  JoinRequestResponseDTO,
  JoinRequestFilter,
  JoinRequestStatus,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupJoinRequest } from 'src/entities/group-join-request.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { Group } from 'src/entities/group.entity';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class GroupJoinRequestService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(GroupJoinRequest)
    private readonly joinRequestRepo: Repository<GroupJoinRequest>,
  ) {}

  // 📨 User gửi yêu cầu tham gia nhóm
  async requestToJoin(
    groupId: string,
    userId: string,
  ): Promise<{ success: boolean; response: JoinRequestResponseDTO | string }> {
    return this.dataSource.transaction(async (manager) => {
      const groupRepo = manager.getRepository(Group);
      const memberRepo = manager.getRepository(GroupMember);
      const joinRequestRepo = manager.getRepository(GroupJoinRequest);

      const group = await groupRepo.findOne({
        where: { id: groupId },
        relations: ['groupSetting'],
      });
      if (!group) throw new RpcException('Group not found');
      if (group.members >= group.groupSetting.maxMembers)
        throw new RpcException('Group has reached maximum member limit');

      const existingMember = await memberRepo.findOne({
        where: { groupId, userId },
      });
      if (existingMember) {
        if (existingMember.status === GroupMemberStatus.ACTIVE)
          throw new RpcException('User is already a member of the group');
        if (existingMember.status === GroupMemberStatus.BANNED)
          throw new RpcException('User is banned from the group');
      }

      // Auto join public group
      if (group.privacy === GroupPrivacy.PUBLIC) {
        if (existingMember) {
          existingMember.status = GroupMemberStatus.ACTIVE;
          await memberRepo.save(existingMember);
        } else {
          const newMember = memberRepo.create({
            groupId,
            userId,
            status: GroupMemberStatus.ACTIVE,
          });
          await memberRepo.save(newMember);
        }

        group.members += 1;
        await groupRepo.save(group);
        return { success: true, response: 'Joined' };
      }

      // Check trùng request đang pending
      const existingRequest = await joinRequestRepo.findOne({
        where: { groupId, userId, status: JoinRequestStatus.PENDING },
      });
      if (existingRequest)
        throw new RpcException('User already has a pending join request');

      const joinRequest = joinRequestRepo.create({
        groupId,
        userId,
        status: JoinRequestStatus.PENDING,
      });
      await joinRequestRepo.save(joinRequest);

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
      if (!joinRequest) throw new RpcException('Join request not found');
      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException('Request already processed');

      const group = await groupRepo.findOne({
        where: { id: joinRequest.groupId },
        relations: ['groupSetting'],
      });
      if (!group) throw new RpcException('Group not found');
      if (group.members >= group.groupSetting.maxMembers)
        throw new RpcException('Group has reached maximum member limit');

      const member = await memberRepo.findOne({
        where: {
          groupId: joinRequest.groupId,
          userId: joinRequest.userId,
        },
      });

      if (member) {
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
      await groupRepo.save(group);

      joinRequest.status = JoinRequestStatus.APPROVED;
      joinRequest.updatedBy = approverId;
      await joinRequestRepo.save(joinRequest);

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
      if (!joinRequest) throw new RpcException('Join request not found');
      if (joinRequest.status !== JoinRequestStatus.PENDING)
        throw new RpcException('Request already processed');

      joinRequest.status = JoinRequestStatus.REJECTED;
      joinRequest.updatedBy = approverId;
      await joinRequestRepo.save(joinRequest);

      return true;
    });
  }

  async filterRequests(
    groupId: string,
    filter: JoinRequestFilter,
  ): Promise<CursorPageResponse<JoinRequestResponseDTO>> {
    const {
      sortBy = 'createdAt',
      order = 'DESC',
      cursor,
      limit = 20,
      status,
    } = filter;

    const query = this.joinRequestRepo
      .createQueryBuilder('request')
      .where('request.groupId = :groupId', { groupId });

    // Lọc theo trạng thái nếu có
    if (status) {
      query.andWhere('request.status = :status', { status });
    }

    // Phân trang dạng cursor-based
    if (cursor) {
      if (sortBy === 'createdAt') {
        query.andWhere(
          order === 'DESC'
            ? 'request.createdAt < :cursor'
            : 'request.createdAt > :cursor',
          { cursor },
        );
      } else if (sortBy === 'id') {
        query.andWhere(
          order === 'DESC' ? 'request.id < :cursor' : 'request.id > :cursor',
          { cursor },
        );
      }
    }

    // Sắp xếp và giới hạn
    query.orderBy(`request.${sortBy}`, order.toUpperCase() as 'ASC' | 'DESC');
    query.take(limit + 1); // lấy dư 1 bản ghi để kiểm tra hasNextPage

    const results = await query.getMany();

    // Kiểm tra còn trang tiếp theo không
    const hasNextPage = results.length > limit;
    const data = results.slice(0, limit);

    // Lấy nextCursor (từ bản ghi cuối cùng trong danh sách hợp lệ)
    const nextCursor = hasNextPage
      ? sortBy === 'createdAt'
        ? data[data.length - 1].createdAt.toISOString()
        : data[data.length - 1].id
      : null;

    return new CursorPageResponse<JoinRequestResponseDTO>(
      plainToInstance(JoinRequestResponseDTO, data),
      nextCursor,
      hasNextPage,
    );
  }
}
