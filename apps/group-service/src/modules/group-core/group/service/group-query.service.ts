import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { validate as isUUID } from 'uuid';
import {
  CursorPageResponse,
  CursorPaginationDTO,
  GroupMemberStatus,
  GroupPrivacy,
  GroupResponseDTO,
  GroupRole,
  GroupStatus,
  InvitedGroupDTO,
  InviteStatus,
  MembershipStatus,
} from '@repo/dtos';
import { Group } from 'src/entities/group.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupCacheService } from './group-cache.service';
import { SocialClientService } from 'src/modules/client/social/social-client.service';
import { GroupMapper } from 'src/common/mapper/group.mapper';
import { GroupInvite } from 'src/entities/group-invite.entity';
import { UserClientService } from 'src/modules/client/user/user-client.service';

@Injectable()
export class GroupQueryService {
  private readonly DEFAULT_FRIENDS_LIMIT = 50;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepo: Repository<GroupMember>,
    @InjectRepository(GroupInvite)
    private readonly groupInviteRepo: Repository<GroupInvite>,
    private readonly groupCacheService: GroupCacheService,
    private readonly socialClientService: SocialClientService,
    private readonly userClientService: UserClientService,
  ) {}

  // ---------- Public API (refactored & optimized) ----------

  async findById(groupId: string, userId?: string): Promise<GroupResponseDTO> {
    if (!isUUID(groupId))
      throw new RpcException({
        statusCode: 400,
        message: 'Invalid group ID format',
      });

    // 1) Try cache entity
    let entity = await this.groupCacheService.get(groupId);
    if (!entity || entity === 'NOT_FOUND') {
      // Load from DB
      entity = await this.groupRepo.findOne({
        where: { id: groupId },
        relations: ['groupSetting'],
      });
      if (!entity) {
        await this.groupCacheService.setNotFound(groupId).catch(() => void 0);
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found',
        });
      }
      // Cache entity
      await this.groupCacheService.set(groupId, entity).catch(() => void 0);
    }

    // Chuyển entity sang DTO
    const dto = GroupMapper.toGroupResponseDTO(entity);

    // Chỉ query member nếu userId được cung cấp
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
    const qb = this.buildGroupQuery({ userId }, query);
    return this.paginateGroups(qb, query?.limit || 10);
  }

  async recommendGroups(
    userId: string,
    query?: CursorPaginationDTO,
  ): Promise<CursorPageResponse<GroupResponseDTO>> {
    const MIN_RECOMMEND = 5;
    const PAGE_LIMIT = query?.limit || 10;

    // =========================
    // 1) Get friend ids
    // =========================
    const friends = await this.socialClientService.getFriendsIds(userId);
    const friendIds = (friends || []).slice(0, this.DEFAULT_FRIENDS_LIMIT);

    // =========================
    // 2) Groups that friends joined
    // (có thể rỗng – KHÔNG return sớm)
    // =========================
    let friendGroupIds: string[] = [];

    if (friendIds.length > 0) {
      const friendGroupRows = await this.groupMemberRepo
        .createQueryBuilder('m')
        .select('m.groupId', 'groupId')
        .addSelect('COUNT(m.userId)', 'friendCount') // chỉ để debug / mở rộng
        .where('m.userId IN (:...friendIds)', { friendIds })
        .andWhere('m.status = :status', {
          status: GroupMemberStatus.ACTIVE,
        })
        .groupBy('m.groupId')
        .orderBy('COUNT(m.userId)', 'DESC') // ✅ QUAN TRỌNG
        .limit(500)
        .getRawMany();

      friendGroupIds = friendGroupRows.map((r) => r.groupId).filter(Boolean);
    }

    // =========================
    // 3) Groups user already joined
    // =========================
    const myGroupRows = await this.groupMemberRepo.find({
      where: { userId },
      select: ['groupId'],
    });

    const myGroupIds = new Set(myGroupRows.map((r) => r.groupId));

    // =========================
    // 4) Initial candidates
    // =========================
    let candidateIds = friendGroupIds.filter((id) => !myGroupIds.has(id));

    // =========================
    // 5) Fallback: PUBLIC groups
    // =========================
    if (candidateIds.length < MIN_RECOMMEND) {
      const needMore = MIN_RECOMMEND - candidateIds.length;

      const publicGroupRows = await this.groupRepo
        .createQueryBuilder('g')
        .select('g.id', 'id')
        .leftJoin('g.groupMembers', 'm', 'm.userId = :userId', { userId })
        .where('g.privacy = :privacy', {
          privacy: GroupPrivacy.PUBLIC,
        })
        .andWhere('m.id IS NULL')
        .andWhere(
          candidateIds.length > 0 ? 'g.id NOT IN (:...excludeIds)' : '1=1',
          { excludeIds: candidateIds },
        )
        .orderBy('g.createdAt', 'DESC')
        .limit(needMore)
        .getRawMany();

      candidateIds.push(...publicGroupRows.map((r) => r.id));
    }

    // =========================
    // 6) Final guard
    // =========================
    if (candidateIds.length === 0) {
      return new CursorPageResponse<GroupResponseDTO>([], null, false);
    }

    // =========================
    // 7) Build query + paginate
    // =========================
    const qb = this.buildGroupQuery({ groupIds: candidateIds }, query);

    return this.paginateGroups(qb, PAGE_LIMIT);
  }

  async getInvitedGroups(
    userId: string,
    query?: CursorPaginationDTO,
  ): Promise<CursorPageResponse<InvitedGroupDTO>> {
    const pageLimit = query?.limit || 10;

    // =========================
    // 1) Lấy danh sách groupId được invite
    // =========================
    const inviteRows = await this.dataSource
      .getRepository(GroupInvite)
      .createQueryBuilder('i')
      .select('i.groupId', 'groupId')
      .where('i.inviteeId = :userId', { userId })
      .andWhere('i.status = :status', { status: InviteStatus.PENDING })
      .andWhere('(i.expiredAt IS NULL OR i.expiredAt > now())')
      .orderBy('i.createdAt', 'DESC')
      .limit(500)
      .getRawMany();

    const invitedGroupIds = inviteRows.map((r) => r.groupId).filter(Boolean);

    if (!invitedGroupIds.length) {
      return new CursorPageResponse<InvitedGroupDTO>([], null, false);
    }

    // =========================
    // 2) Query group
    // =========================
    const qb = this.buildGroupQuery({ groupIds: invitedGroupIds }, query);
    const rows = await qb.getMany();

    // =========================
    // 3) Lấy invite tương ứng
    // =========================
    const invites = await this.groupInviteRepo.find({
      where: {
        inviteeId: userId,
        groupId: In(rows.map((g) => g.id)),
        status: InviteStatus.PENDING,
      },
    });

    const inviteMap = new Map<string, GroupInvite>();
    const inviterIds = new Set<string>();

    for (const inv of invites) {
      inviteMap.set(inv.groupId, inv);
      inv.inviters.forEach((id) => inviterIds.add(id));
    }

    // =========================
    // 4) Batch load inviter profiles
    // =========================
    const inviterProfiles =
      inviterIds.size > 0
        ? await this.userClientService.getUserInfos([...inviterIds])
        : {};

    // =========================
    // 5) Paginate + map DTO
    // =========================
    const hasNext = rows.length > pageLimit;
    const data = rows.slice(0, pageLimit);
    const nextCursor = hasNext
      ? data[data.length - 1].createdAt.toISOString()
      : null;

    const dtos: InvitedGroupDTO[] = data.map((g) => {
      const base = GroupMapper.toGroupResponseDTO(g);
      const invite = inviteMap.get(g.id);

      const dto = Object.assign(new InvitedGroupDTO(), base);
      dto.inviterNames = invite
        ? invite.inviters
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
  private buildGroupQuery(
    filter: { userId?: string; groupIds?: string[] },
    query?: CursorPaginationDTO,
  ): SelectQueryBuilder<Group> {
    const {
      cursor,
      limit = 10,
      sortBy = 'createdAt',
      order = 'DESC',
    } = query || {};

    const qb = this.groupRepo
      .createQueryBuilder('group')
      .where('group.status = :status', { status: GroupStatus.ACTIVE });

    // Always join members when userId filter is used
    if (filter.userId) qb.leftJoin('group.groupMembers', 'groupMember');

    if (filter.userId) {
      qb.andWhere('groupMember.userId = :userId', { userId: filter.userId });
    }

    if (filter.groupIds && filter.groupIds.length) {
      qb.andWhere('group.id IN (:...groupIds)', { groupIds: filter.groupIds });
    }

    if (cursor) {
      // cursor assumed to be an id; for robust cursoring, consider createdAt+id tuple
      qb.andWhere('group.id > :cursor', { cursor });
    }

    qb.orderBy(`group.${sortBy}`, order as 'ASC' | 'DESC').take(limit + 1);

    return qb;
  }

  private async paginateGroups(
    qb: SelectQueryBuilder<Group>,
    limit = 10,
    sortBy = 'createdAt',
  ): Promise<CursorPageResponse<GroupResponseDTO>> {
    const rows = await qb.getMany();
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
    const member = await this.groupMemberRepo.findOne({
      where: { userId, groupId },
      select: ['status', 'role'],
    });

    if (member) {
      if (member.status === GroupMemberStatus.BANNED)
        return { membershipStatus: MembershipStatus.BANNED, role: null };
      if (member.status === GroupMemberStatus.ACTIVE)
        return { membershipStatus: MembershipStatus.MEMBER, role: member.role };
    }

    const joinRequest = await this.dataSource
      .getRepository('GroupJoinRequest')
      .findOne({
        where: { userId, groupId, status: 'PENDING' },
      });

    if (joinRequest)
      return {
        membershipStatus: MembershipStatus.PENDING_APPROVAL,
        role: null,
      };

    const invite = await this.dataSource.getRepository('GroupInvite').findOne({
      where: { inviteeId: userId, groupId, status: 'PENDING' },
    });
    if (invite)
      return {
        membershipStatus: MembershipStatus.INVITED,
        role: null,
      };

    return { membershipStatus: MembershipStatus.NONE, role: null };
  }
}
