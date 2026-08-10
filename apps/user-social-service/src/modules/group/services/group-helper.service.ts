import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { GroupInfoDTO, GroupRole, PostPermissionDTO } from '@repo/dtos';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import { groupMembers, groupSettings, groups } from 'src/drizzle/schema/schema';
import { GroupCacheService } from './group-cache.service';
import { ROLE_PERMISSIONS } from 'src/modules/group/common/constant/role-permission.constant';

@Injectable()
export class GroupHelperService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly groupCacheService: GroupCacheService,
  ) {}

  async getGroupUserPermissions(
    userId: string,
    groupId: string,
  ): Promise<PostPermissionDTO> {
    const [group] = await this.db
      .select()
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);

    if (!group)
      throw new RpcException({ statusCode: 404, message: 'Group not found' });

    const [setting] = await this.db
      .select()
      .from(groupSettings)
      .where(eq(groupSettings.groupId, groupId))
      .limit(1);

    const [member] = await this.db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.userId, userId),
          eq(groupMembers.groupId, groupId),
        ),
      )
      .limit(1);

    const finalPermissions: PostPermissionDTO = {
      isMember: !!member,
      privacy: group.privacy as any,
      requireApproval: setting?.requiredPostApproval ?? false,
      role: (member?.role as GroupRole) ?? null,
      permissions: [
        ...ROLE_PERMISSIONS[(member?.role as GroupRole) ?? GroupRole.MEMBER],
        ...((member?.customPermissions as any[]) ?? []),
      ],
    };

    return finalPermissions;
  }

  async getGroupsBatchInfo(groupIds: string[]): Promise<GroupInfoDTO[]> {
    if (!groupIds.length) return [];

    const cached = await this.groupCacheService.getBatch(groupIds);
    const missIds = groupIds.filter((id) => !cached.has(id));

    const dbGroups = await this.getSummaryGroupsFromDB(missIds);
    await this.groupCacheService.setBatch(dbGroups);

    const foundIds = new Set(dbGroups.map((g) => g.id));
    const notFoundIds = missIds.filter((id) => !foundIds.has(id));
    await this.groupCacheService.setNotFoundBatch(notFoundIds);

    const result: GroupInfoDTO[] = [];
    dbGroups.forEach((g) => result.push(g));
    cached.forEach((v) => {
      if (v !== 'NOT_FOUND') result.push(v as any);
    });

    return result;
  }

  private async getSummaryGroupsFromDB(groupIds: string[]): Promise<GroupInfoDTO[]> {
    if (!groupIds.length) return [];

    const rows = await this.db
      .select({
        id: groups.id,
        name: groups.name,
        avatar: groups.avatar,
      })
      .from(groups)
      .where(inArray(groups.id, groupIds));

    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      avatarUrl: (g.avatar as any)?.url,
    }) as GroupInfoDTO);
  }
}
