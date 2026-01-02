import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { GroupInfoDTO, GroupRole, PostPermissionDTO } from '@repo/dtos';
import { Group } from 'src/entities/group.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupCacheService } from './group-cache.service';
import { ROLE_PERMISSIONS } from 'src/common/constant/role-permission.constant';

@Injectable()
export class GroupHelperService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepo: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly groupMemberRepo: Repository<GroupMember>,
    private readonly groupCacheService: GroupCacheService,
  ) {}

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

  // Get Group Batch Info
  async getGroupsBatchInfo(groupIds: string[]): Promise<GroupInfoDTO[]> {
    if (!groupIds.length) return [];

    const cached = await this.groupCacheService.getBatch(groupIds);
    const missIds = groupIds.filter((id) => !cached.has(id));

    const dbGroups = await this.getSummaryGroupsFromDB(missIds);

    await this.groupCacheService.setBatch(dbGroups);

    const foundIds = new Set(dbGroups.map((g) => g.id));
    const notFoundIds = missIds.filter((id) => !foundIds.has(id));
    await this.groupCacheService.setNotFoundBatch(notFoundIds);

    // merge
    const result: GroupInfoDTO[] = [];

    dbGroups.forEach((g) => result.push(g));
    cached.forEach((v) => {
      if (v !== 'NOT_FOUND') {
        result.push(v);
      }
    });

    return result;
  }

  // ==============================================
  // ---------- Private helpers -------------------
  // ==============================================
  private async getSummaryGroupsFromDB(
    groupIds: string[],
  ): Promise<GroupInfoDTO[]> {
    if (!groupIds.length) return [];

    const groups = await this.groupRepo
      .createQueryBuilder('g')
      .select(['g.id', 'g.name', 'g.avatar'])
      .where('g.id IN (:...groupIds)', { groupIds })
      .getMany();

    return groups.map(
      (g) =>
        ({
          id: g.id,
          name: g.name,
          avatarUrl: g.avatar.url,
        }) as GroupInfoDTO,
    );
  }
}
