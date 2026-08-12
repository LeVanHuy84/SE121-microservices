import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { validate as isUUID } from 'uuid';
import {
  CursorPageResponse,
  GroupMemberStatus,
  GroupPrivacy,
  GroupResponseDTO,
  GroupRole,
  GroupStatus,
  InvitedGroupDTO,
  InviteStatus,
  MembershipStatus,
} from '@repo/dtos';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import {
  groups,
  groupMembers,
  groupInvites,
  groupJoinRequests,
  groupSettings,
} from 'src/drizzle/schema/schema';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';
import { GroupCacheService } from './group-cache.service';
import { GroupMapper } from 'src/modules/group/common/mapper/group.mapper';
import { UserService } from 'src/modules/user/user.service';
import { FriendshipService } from 'src/modules/social/friendship/friendship.service';
import type { CursorPaginationDTO } from '@repo/dtos';

@Injectable()
export class GroupQueryService {
  private readonly DEFAULT_FRIENDS_LIMIT = 50;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly groupCacheService: GroupCacheService,
    private readonly friendshipService: FriendshipService,
    private readonly userService: UserService,
  ) {}

  // ---------- Public API ----------

  async findById(groupId: string, userId?: string): Promise<GroupResponseDTO> {
    if (!isUUID(groupId))
      throw new RpcException({
        statusCode: 400,
        message: 'Invalid group ID format',
      });

    // 1) Try cache
    let entity = await this.groupCacheService.get(groupId);
    if (!entity || entity === 'NOT_FOUND') {
      const rows = await this.db
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1);

      entity = rows[0] as any;
      if (!entity) {
        await this.groupCacheService.setNotFound(groupId).catch(() => void 0);
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found',
        });
      }
      await this.groupCacheService.set(groupId, entity as any).catch(() => void 0);
    }

    if (entity === 'NOT_FOUND') {
      throw new RpcException({ statusCode: 404, message: 'Group not found' });
    }

    const dto = GroupMapper.toGroupResponseDTO(entity as any);

    if (userId) {
      const { membershipStatus, role } = await this.checkMembershipStatus(
        userId,
        groupId,
      );
      dto.membershipStatus = membershipStatus;
      dto.userRole = role || undefined;
    }

    return dto;
  }

  async getMyGroups(
    userId: string,
    query?: CursorPaginationDTO,
  ): Promise<CursorPageResponse<GroupResponseDTO>> {
    const limit = query?.limit || 10;
    const rows = await this.buildGroupQuery({ userId }, query);
    return this.paginateGroups(rows, limit);
  }

  async recommendGroups(
    userId: string,
    query?: CursorPaginationDTO,
  ): Promise<CursorPageResponse<GroupResponseDTO>> {
    const MIN_RECOMMEND = 5;
    const PAGE_LIMIT = query?.limit || 10;

    // 1) Get friend ids
    let friendIds: string[] = [];
    try {
      friendIds = await this.friendshipService.getFriendIds(userId, this.DEFAULT_FRIENDS_LIMIT);
    } catch (err) {
      // ignore
    }

    // 2) Groups that friends joined
    let friendGroupIds: string[] = [];

    if (friendIds.length > 0) {
      const friendGroupRows = await this.db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(
          and(
            inArray(groupMembers.userId, friendIds),
            eq(groupMembers.status, GroupMemberStatus.ACTIVE),
          ),
        );

      friendGroupIds = friendGroupRows
        .map((r) => r.groupId)
        .filter(Boolean);
    }

    // 3) Groups user already joined
    const myGroupRows = await this.db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));

    const myGroupIds = new Set(myGroupRows.map((r) => r.groupId));

    // 4) Initial candidates
    let candidateIds = friendGroupIds.filter((id) => !myGroupIds.has(id));

    // 5) Fallback: PUBLIC groups
    if (candidateIds.length < MIN_RECOMMEND) {
      const needMore = MIN_RECOMMEND - candidateIds.length;
      const conditions = [
        eq(groups.privacy, GroupPrivacy.PUBLIC),
        eq(groups.status, GroupStatus.ACTIVE),
      ];
      if (candidateIds.length > 0) {
        conditions.push(notInArray(groups.id, candidateIds) as any);
      }

      // exclude groups user is already in
      const publicRows = await this.db
        .select({ id: groups.id })
        .from(groups)
        .where(and(...conditions))
        .orderBy(desc(groups.createdAt))
        .limit(needMore);

      candidateIds.push(...publicRows.map((r) => r.id));
    }

    if (candidateIds.length === 0) {
      return new CursorPageResponse<GroupResponseDTO>([], null, false);
    }

    const rows = await this.buildGroupQuery({ groupIds: candidateIds }, query);
    return this.paginateGroups(rows, PAGE_LIMIT);
  }

  async getInvitedGroups(
    userId: string,
    query?: CursorPaginationDTO,
  ): Promise<CursorPageResponse<InvitedGroupDTO>> {
    const pageLimit = query?.limit || 10;

    // 1) Get invited group ids
    const inviteRows = await this.db
      .select({ groupId: groupInvites.groupId })
      .from(groupInvites)
      .where(
        and(
          eq(groupInvites.inviteeId, userId),
          eq(groupInvites.status, InviteStatus.PENDING),
          sql`(${groupInvites.expiredAt} IS NULL OR ${groupInvites.expiredAt} > now())`,
        ),
      )
      .orderBy(desc(groupInvites.createdAt))
      .limit(500);

    const invitedGroupIds = inviteRows.map((r) => r.groupId).filter(Boolean);

    if (!invitedGroupIds.length) {
      return new CursorPageResponse<InvitedGroupDTO>([], null, false);
    }

    // 2) Query groups
    const rows = await this.buildGroupQuery({ groupIds: invitedGroupIds }, query);

    // 3) Get matching invites
    const invites = await this.db
      .select()
      .from(groupInvites)
      .where(
        and(
          eq(groupInvites.inviteeId, userId),
          inArray(
            groupInvites.groupId,
            rows.map((g) => g.id),
          ),
          eq(groupInvites.status, InviteStatus.PENDING),
        ),
      );

    const inviteMap = new Map<string, typeof invites[0]>();
    const inviterIds = new Set<string>();

    for (const inv of invites) {
      inviteMap.set(inv.groupId, inv);
      (inv.inviters || []).forEach((id) => inviterIds.add(id));
    }

    // 4) Batch load inviter profiles directly via userService
    const inviterProfiles =
      inviterIds.size > 0
        ? await this.userService.getBaseUsersBatch([...inviterIds])
        : {};

    // 5) Paginate + map DTO
    const hasNext = rows.length > pageLimit;
    const data = rows.slice(0, pageLimit);
    const nextCursor = hasNext
      ? (data[data.length - 1] as any).createdAt?.toISOString()
      : null;

    const dtos: InvitedGroupDTO[] = data.map((g) => {
      const base = GroupMapper.toGroupResponseDTO(g as any);
      const invite = inviteMap.get(g.id);
      const dto = Object.assign(new InvitedGroupDTO(), base);
      dto.inviterNames = invite
        ? (invite.inviters || [])
            .map((id) =>
              `${inviterProfiles[id]?.firstName || ''} ${
                inviterProfiles[id]?.lastName || ''
              }`.trim(),
            )
            .filter(Boolean)
        : [];
      return dto;
    });

    return new CursorPageResponse(dtos, nextCursor, hasNext);
  }

  // ==============================================
  // ---------- Private helpers -------------------
  // ==============================================
  private async buildGroupQuery(
    filter: { userId?: string; groupIds?: string[] },
    query?: CursorPaginationDTO,
  ) {
    const {
      cursor,
      limit = 10,
      sortBy = 'createdAt',
      order = 'DESC',
    } = query || {};

    const conditions: any[] = [eq(groups.status, GroupStatus.ACTIVE)];

    if (filter.userId) {
      const memberGroupIds = await this.db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(eq(groupMembers.userId, filter.userId));

      const ids = memberGroupIds.map((r) => r.groupId);
      if (ids.length === 0) return [];
      conditions.push(inArray(groups.id, ids));
    }

    if (filter.groupIds && filter.groupIds.length) {
      conditions.push(inArray(groups.id, filter.groupIds));
    }

    if (cursor) {
      conditions.push(gt(groups.id, cursor));
    }

    const orderExpr =
      order === 'DESC' ? desc(groups[sortBy]) : asc(groups[sortBy]);

    return this.db
      .select()
      .from(groups)
      .where(and(...conditions))
      .orderBy(orderExpr)
      .limit(limit + 1);
  }

  private paginateGroups(
    rows: any[],
    limit = 10,
    sortBy = 'createdAt',
  ): CursorPageResponse<GroupResponseDTO> {
    const hasNext = rows.length > limit;
    const data = rows.slice(0, limit);
    const nextCursor = hasNext ? data[data.length - 1][sortBy] : null;
    const dtos = data.map((g) => GroupMapper.toGroupResponseDTO(g));
    return new CursorPageResponse(dtos, nextCursor, hasNext);
  }

  private async checkMembershipStatus(
    userId: string,
    groupId: string,
  ): Promise<{ membershipStatus: MembershipStatus; role: GroupRole | null }> {
    const [member] = await this.db
      .select({ status: groupMembers.status, role: groupMembers.role })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, userId),
          eq(groupMembers.groupId, groupId),
        ),
      )
      .limit(1);

    if (member) {
      if (member.status === GroupMemberStatus.BANNED)
        return { membershipStatus: MembershipStatus.BANNED, role: null };
      if (member.status === GroupMemberStatus.ACTIVE)
        return {
          membershipStatus: MembershipStatus.MEMBER,
          role: member.role as GroupRole,
        };
    }

    const [joinRequest] = await this.db
      .select({ id: groupJoinRequests.id })
      .from(groupJoinRequests)
      .where(
        and(
          eq(groupJoinRequests.userId, userId),
          eq(groupJoinRequests.groupId, groupId),
          eq(groupJoinRequests.status, 'PENDING' as any),
        ),
      )
      .limit(1);

    if (joinRequest)
      return { membershipStatus: MembershipStatus.PENDING_APPROVAL, role: null };

    const [invite] = await this.db
      .select({ id: groupInvites.id })
      .from(groupInvites)
      .where(
        and(
          eq(groupInvites.inviteeId, userId),
          eq(groupInvites.groupId, groupId),
          eq(groupInvites.status, InviteStatus.PENDING),
        ),
      )
      .limit(1);

    if (invite)
      return { membershipStatus: MembershipStatus.INVITED, role: null };

    return { membershipStatus: MembershipStatus.NONE, role: null };
  }
}
