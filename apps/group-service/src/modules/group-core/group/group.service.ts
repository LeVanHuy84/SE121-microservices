import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { validate as isUUID } from 'uuid';

import {
  CreateGroupDTO,
  CursorPageResponse,
  CursorPaginationDTO,
  EventDestination,
  EventTopic,
  GroupEventLog,
  GroupEventType,
  GroupMemberStatus,
  GroupPrivacy,
  GroupResponseDTO,
  GroupRole,
  GroupStatus,
  InferGroupPayload,
  MembershipStatus,
  PostPermissionDTO,
  UpdateGroupDTO,
} from '@repo/dtos';

import { instanceToPlain, plainToInstance } from 'class-transformer';
import { Group } from 'src/entities/group.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupSetting } from 'src/entities/group-setting.entity';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { GroupCacheService } from './group-cache.service';
import { GroupLogService } from 'src/modules/group-log/group-log.service';
import { SocialClientService } from 'src/modules/client/social/social-client.service';
import { ROLE_PERMISSIONS } from 'src/common/constant/role-permission.constant';
import { UserClientService } from 'src/modules/client/user/user-client.service';
import { formatValue, GROUP_FIELD_LABELS } from 'src/common/constant/constant';

@Injectable()
export class GroupService {
  private readonly DEFAULT_FRIENDS_LIMIT = 50;

  constructor(
    private readonly dataSource: DataSource,

    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,

    @InjectRepository(GroupMember)
    private readonly groupMemberRepo: Repository<GroupMember>,

    private readonly groupLogService: GroupLogService,
    private readonly groupCacheService: GroupCacheService,
    private readonly socialClientService: SocialClientService,
    private readonly userClient: UserClientService,
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
    if (!entity) {
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
    const plain = instanceToPlain(entity);
    const dto = plainToInstance(GroupResponseDTO, plain, {
      excludeExtraneousValues: true,
    });

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

  async createGroup(
    userId: string,
    dto: CreateGroupDTO,
  ): Promise<GroupResponseDTO> {
    return this.dataSource.transaction(async (manager) => {
      // Create group + default setting
      const groupRepo = manager.getRepository(Group);
      const memberRepo = manager.getRepository(GroupMember);

      const owner = await this.userClient.getUserInfo(userId);

      if (!owner) {
        throw new RpcException({
          statusCode: 404,
          message: 'Owner not found',
        });
      }

      const group = groupRepo.create({
        ...dto,
        createdBy: userId,
        owner: {
          id: owner.id,
          fullName: `${owner.firstName} ${owner.lastName}`,
          avatarUrl: owner.avatarUrl,
        },
        groupSetting: new GroupSetting(),
      });
      group.groupSetting.createdBy = userId;

      const savedGroup = await groupRepo.save(group);

      const ownerMember = memberRepo.create({
        userId,
        groupId: savedGroup.id,
        role: GroupRole.OWNER,
        group: savedGroup,
      });
      await memberRepo.save(ownerMember);

      // Outbox event
      const payload: InferGroupPayload<GroupEventType.CREATED> = {
        groupId: savedGroup.id,
        name: savedGroup.name,
        description: savedGroup.description,
        avatarUrl: savedGroup.avatarUrl,
        privacy: savedGroup.privacy,
        members: 1,
        createdAt: savedGroup.createdAt,
      };
      await this.createOutboxEvent(manager, GroupEventType.CREATED, {
        data: payload,
      });

      // Cache
      await this.groupCacheService
        .set(savedGroup.id, savedGroup)
        .catch(() => void 0);

      return plainToInstance(GroupResponseDTO, savedGroup, {
        excludeExtraneousValues: true,
      });
    });
  }

  async updateGroup(
    userId: string,
    groupId: string,
    dto: Partial<UpdateGroupDTO>,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Group);
      const group = await repo.findOne({ where: { id: groupId } });

      if (!group) {
        throw new RpcException({
          statusCode: 404,
          message: 'Group not found',
        });
      }

      // 🔹 Build diff BEFORE update
      const changes = Object.entries(dto)
        .filter(([key, value]) => group[key] !== value)
        .map(([key, value]) => ({
          field: GROUP_FIELD_LABELS[key] ?? key,
          from: formatValue(group[key]),
          to: formatValue(value),
        }));

      // Update
      Object.assign(group, dto);
      group.updatedBy = userId;

      const updated = await repo.save(group);

      // 🔹 Log only when something actually changed
      if (changes.length > 0) {
        await this.groupLogService.log(manager, {
          groupId: updated.id,
          userId,
          eventType: GroupEventLog.GROUP_UPDATED,
          content: `Cập nhật thông tin nhóm:\n${changes
            .map((c) => `- ${c.field}: ${c.from} → ${c.to}`)
            .join('\n')}`,
        });
      }

      // Outbox event
      const payload: InferGroupPayload<GroupEventType.UPDATED> = {
        groupId: updated.id,
        name: updated.name,
        description: updated.description,
        avatarUrl: updated.avatarUrl,
        privacy: updated.privacy,
        members: updated.members,
      };

      await this.createOutboxEvent(manager, GroupEventType.UPDATED, {
        data: payload,
      });

      // Invalidate cache
      await this.groupCacheService.del(groupId).catch(() => void 0);

      return updated;
    });
  }

  async deleteGroup(userId: string, groupId: string): Promise<boolean> {
    const repo = this.groupRepo;
    const group = await repo.findOne({ where: { id: groupId } });
    if (!group)
      throw new RpcException({
        statusCode: 404,
        message: 'Group not found',
      });

    group.updatedBy = userId;
    group.status = GroupStatus.DELETED;
    await repo.save(group);

    const payload: InferGroupPayload<GroupEventType.REMOVED> = {
      groupId: group.id,
    };
    await this.createOutboxEvent(
      this.dataSource.manager,
      GroupEventType.REMOVED,
      { data: payload },
    );

    // Invalidate cache
    await this.groupCacheService.del(groupId).catch(() => void 0);

    return true;
  }

  async getGroupUserPermissions(
    userId: string,
    groupId: string,
  ): Promise<PostPermissionDTO> {
    const group = await this.groupRepo.findOne({
      where: { id: groupId },
      relations: ['groupSetting'],
    });
    if (!group)
      throw new RpcException({
        statusCode: 404,
        message: 'Group not found',
      });

    const member = await this.groupMemberRepo.findOneBy({ userId, groupId });

    const finalPermissions: PostPermissionDTO = {
      isMember: !!member,
      privacy: group.privacy,
      requireApproval: group?.groupSetting?.requiredPostApproval ?? false,
      role: member?.role ?? null,
      permissions: [
        ...ROLE_PERMISSIONS[member?.role ?? GroupRole.MEMBER],
        ...(member?.customPermissions ?? []),
      ],
    };

    return finalPermissions;
  }

  // ---------- Private helpers ----------

  private async createOutboxEvent(
    manager: any,
    eventType: GroupEventType,
    payload: any,
  ) {
    const outboxRepo = manager.getRepository(OutboxEvent);
    const event = outboxRepo.create({
      destination: EventDestination.KAFKA,
      topic: EventTopic.GROUP_CRUD,
      eventType,
      payload: payload.data,
    });
    await outboxRepo.save(event);
  }

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

    const dtos = data.map((g) => plainToInstance(GroupResponseDTO, g));
    return new CursorPageResponse(dtos, nextCursor, hasNext);
  }

  private async checkMembershipStatus(
    userId: string,
    groupId: string,
  ): Promise<{ membershipStatus: MembershipStatus; role: GroupRole | null }> {
    const member = await this.groupMemberRepo.findOne({
      where: { userId, groupId },
      select: ['role'],
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
