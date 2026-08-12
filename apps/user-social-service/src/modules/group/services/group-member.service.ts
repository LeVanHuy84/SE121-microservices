import { Inject, Injectable } from '@nestjs/common';
import {
  ActivityType,
  CursorPageResponse,
  EventDestination,
  EventTopic,
  GroupEventLog,
  GroupMemberDTO,
  GroupMemberFilter,
  GroupMemberStatus,
  GroupPermission,
  GroupRole,
  NotiOutboxPayload,
  NotiTargetType,
} from '@repo/dtos';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import {
  groupMembers,
  groups,
  outboxEvents,
} from 'src/drizzle/schema/schema';
import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { RpcException } from '@nestjs/microservices';
import { plainToInstance } from 'class-transformer';
import { GroupLogService } from './group-log.service';
import { UserService } from 'src/modules/user/user.service';

@Injectable()
export class GroupMemberService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly groupLogService: GroupLogService,
    private readonly userService: UserService,
  ) {}

  async leaveGroup(userId: string, groupId: string) {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.userId, userId),
            eq(groupMembers.groupId, groupId),
          ),
        )
        .limit(1);

      if (!member)
        throw new RpcException({ statusCode: 404, message: 'Member not found' });
      if (member.role === GroupRole.OWNER) {
        throw new RpcException({
          statusCode: 403,
          message: 'Owner cannot leave the group',
        });
      }

      // Get group name for activity log
      const [group] = await tx
        .select({ name: groups.name })
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      await tx.delete(groupMembers).where(eq(groupMembers.id, member.id));

      await this.groupLogService.log(tx, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_LEFT,
        content: `Người dùng đã rời khỏi nhóm`,
      });

      await this.updateMemberCount(tx, groupId, -1);

      await tx.insert(outboxEvents).values({
        destination: EventDestination.RABBITMQ,
        topic: EventTopic.USER_ACTIVITY_LOG,
        eventType: ActivityType.GROUP_LEFT,
        payload: {
          actorId: userId,
          activityType: ActivityType.GROUP_LEFT,
          targetId: groupId,
          contentPreview: `Bạn đã rời khỏi nhóm ${group?.name ?? ''}`,
          createdAt: new Date(),
        },
      });

      return true;
    });
  }

  async removeMember(userId: string, groupId: string, memberId: string) {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(groupMembers)
        .where(
          and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)),
        )
        .limit(1);

      if (!member)
        throw new RpcException({ statusCode: 404, message: 'Member not found' });
      if (member.role === GroupRole.OWNER)
        throw new RpcException({ statusCode: 403, message: 'Cannot remove the group owner' });

      const executor = await this.getMemberWithRole(tx, groupId, userId);
      if (member.role === GroupRole.ADMIN && executor?.role !== GroupRole.OWNER)
        throw new RpcException({ statusCode: 403, message: 'Only owner can remove an admin' });
      if (userId === member.userId)
        throw new RpcException({ statusCode: 409, message: 'You cannot remove yourself' });
      if (member.status !== GroupMemberStatus.ACTIVE)
        throw new RpcException({ statusCode: 409, message: 'Member is not active' });

      await tx.delete(groupMembers).where(eq(groupMembers.id, member.id));
      const memberName = await this.getUserName(member.userId);

      await this.groupLogService.log(tx, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_REMOVED,
        content: `Thành viên ${memberName} bị xóa khỏi nhóm`,
      });

      await this.updateMemberCount(tx, groupId, -1);
      return true;
    });
  }

  banMember(userId: string, groupId: string, memberId: string) {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(groupMembers)
        .where(
          and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)),
        )
        .limit(1);

      if (!member)
        throw new RpcException({ statusCode: 404, message: 'Member not found' });
      if (member.role === GroupRole.OWNER)
        throw new RpcException({ statusCode: 403, message: 'Cannot ban the group owner' });

      const executor = await this.getMemberWithRole(tx, groupId, userId);
      if (member.role === GroupRole.ADMIN && executor?.role !== GroupRole.OWNER)
        throw new RpcException({ statusCode: 403, message: 'Only owner can ban an admin' });
      if (userId === member.userId)
        throw new RpcException({ statusCode: 409, message: 'You cannot ban yourself' });
      if (member.status !== GroupMemberStatus.ACTIVE)
        throw new RpcException({ statusCode: 409, message: 'Member is not active' });

      await tx
        .update(groupMembers)
        .set({ status: GroupMemberStatus.BANNED })
        .where(eq(groupMembers.id, member.id));

      const memberName = await this.getUserName(member.userId);
      await this.groupLogService.log(tx, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_BANNED,
        content: `Thành viên ${memberName} bị cấm khỏi nhóm`,
      });

      await this.updateMemberCount(tx, groupId, -1);
      return true;
    });
  }

  unbanMember(userId: string, groupId: string, memberId: string) {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(groupMembers)
        .where(
          and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)),
        )
        .limit(1);

      if (!member)
        throw new RpcException({ statusCode: 404, message: 'Member not found' });
      if (member.status !== GroupMemberStatus.BANNED)
        throw new RpcException({ statusCode: 409, message: 'Member is not banned' });

      await tx.delete(groupMembers).where(eq(groupMembers.id, member.id));
      const memberName = await this.getUserName(member.userId);

      await this.groupLogService.log(tx, {
        groupId,
        userId,
        eventType: GroupEventLog.MEMBER_UNBANNED,
        content: `Người dùng ${memberName} được bỏ cấm khỏi nhóm`,
      });

      return true;
    });
  }

  async changeRole(
    userId: string,
    groupId: string,
    newRole: GroupRole,
    memberId: string,
  ) {
    return this.db.transaction(async (tx) => {
      if (newRole === GroupRole.OWNER)
        throw new RpcException({ statusCode: 403, message: 'Cannot assign OWNER role' });

      const [member] = await tx
        .select()
        .from(groupMembers)
        .where(
          and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)),
        )
        .limit(1);

      if (!member)
        throw new RpcException({ statusCode: 404, message: 'Member not found' });
      if (member.role === GroupRole.OWNER)
        throw new RpcException({ statusCode: 403, message: 'Cannot change role of the group owner' });

      const executor = await this.getMemberWithRole(tx, groupId, userId);
      if (member.role === GroupRole.ADMIN && executor?.role !== GroupRole.OWNER)
        throw new RpcException({ statusCode: 403, message: 'Only owner can change role of admin' });

      await tx
        .update(groupMembers)
        .set({ role: newRole as any })
        .where(eq(groupMembers.id, member.id));

      const memberName = await this.getUserName(member.userId);

      await this.groupLogService.log(tx, {
        groupId,
        userId: memberId,
        eventType: GroupEventLog.MEMBER_ROLE_CHANGED,
        content: `Vai trò của thành viên ${memberName} đã được thay đổi thành ${newRole}`,
      });

      // Get group name for notification
      const [group] = await tx
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      await this.createOutboxEvent(
        tx,
        group?.id ?? groupId,
        member.userId,
        `Vai trò của bạn trong nhóm ${group?.name ?? ''} đã được cập nhật thành ${newRole}`,
      );

      return member;
    });
  }

  async addPermission(
    groupId: string,
    memberId: string,
    permissions: GroupPermission[],
  ) {
    return this.db.transaction(async (tx) => {
      const [member] = await tx
        .select()
        .from(groupMembers)
        .where(
          and(eq(groupMembers.id, memberId), eq(groupMembers.groupId, groupId)),
        )
        .limit(1);

      if (!member)
        throw new RpcException({ statusCode: 404, message: 'Member not found' });
      if (member.role === GroupRole.OWNER)
        throw new RpcException({ statusCode: 403, message: 'Cannot change permissions of the group owner' });

      await tx
        .update(groupMembers)
        .set({ customPermissions: permissions })
        .where(eq(groupMembers.id, member.id));

      const memberName = await this.getUserName(member.userId);

      await this.groupLogService.log(tx, {
        groupId,
        userId: memberId,
        eventType: GroupEventLog.MEMBER_PERMISSION_CHANGED,
        content: `Quyền hạn của thành viên ${memberName} đã được thay đổi thành ${permissions.join(', ')}`,
      });

      const [group] = await tx
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      await this.createOutboxEvent(
        tx,
        group?.id ?? groupId,
        member.userId,
        `Quyền hạn của bạn trong nhóm ${group?.name ?? ''} đã được cập nhật`,
      );

      return member;
    });
  }

  async getMembers(
    groupId: string,
    query: GroupMemberFilter,
  ): Promise<CursorPageResponse<GroupMemberDTO>> {
    const { role, status, sortBy, order, cursor, limit } = query;

    const conditions: any[] = [eq(groupMembers.groupId, groupId)];
    if (role) conditions.push(eq(groupMembers.role, role as any));
    if (status) conditions.push(eq(groupMembers.status, status as any));
    if (cursor) conditions.push(lt(groupMembers.id, cursor));

    const orderExpr =
      order === 'DESC'
        ? desc(groupMembers[sortBy || 'createdAt'])
        : asc(groupMembers[sortBy || 'createdAt']);

    const data = await this.db
      .select()
      .from(groupMembers)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(limit + 1);

    const hasNextPage = data.length > limit;
    const nextCursor = hasNextPage ? data[limit - 1].id : null;
    const resultData = hasNextPage ? data.slice(0, limit) : data;

    const dtoData = plainToInstance(GroupMemberDTO, resultData, {
      excludeExtraneousValues: true,
    });

    return { data: dtoData, nextCursor, hasNextPage };
  }

  async getMemberUserIds(groupId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));

    return rows.map((r) => r.userId);
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const [member] = await this.db
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, userId),
        ),
      )
      .limit(1);
    return !!member;
  }

  private async createOutboxEvent(
    tx: any,
    groupId: string,
    receiverId: string,
    content: string,
  ) {
    const payload: NotiOutboxPayload = {
      targetId: groupId,
      targetType: NotiTargetType.GROUP,
      content,
      receivers: [receiverId],
    };

    await tx.insert(outboxEvents).values({
      destination: EventDestination.RABBITMQ,
      topic: 'notification',
      eventType: 'group_noti',
      payload,
    });
  }

  private async updateMemberCount(tx: any, groupId: string, delta: number) {
    const [group] = await tx
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (!group)
      throw new RpcException({ statusCode: 404, message: 'Group not found' });
    await tx
      .update(groups)
      .set({ members: group.members + delta })
      .where(eq(groups.id, groupId));
  }

  private async getMemberWithRole(tx: any, groupId: string, userId: string) {
    const [m] = await tx
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, groupId),
          eq(groupMembers.userId, userId),
        ),
      )
      .limit(1);
    return m;
  }

  private async getUserName(userId: string): Promise<string> {
    const userInfo = await this.userService.findOne(userId);
    return (
      `${userInfo?.firstName ?? ''} ${userInfo?.lastName ?? ''}`.trim() ||
      'Người dùng'
    );
  }
}
