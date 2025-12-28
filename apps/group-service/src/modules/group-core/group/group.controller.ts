import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GroupService } from './group.service';
import {
  CreateGroupDTO,
  CursorPaginationDTO,
  GroupPermission,
  GroupRole,
  UpdateGroupDTO,
} from '@repo/dtos';
import { RequireGroupPermission } from 'src/modules/group-authorization/require-group-permission.decorator';
import { RequireGroupRole } from 'src/modules/group-authorization/require-group-role.decatator';
import { GroupQueryService } from './group-query.service';

@Controller('group')
export class GroupController {
  constructor(
    private readonly groupService: GroupService,
    private readonly groupQueryService: GroupQueryService,
  ) {}

  @MessagePattern('health_check')
  async healthCheck() {
    return { status: 'ok' };
  }

  @MessagePattern('find_group_by_id')
  async getGroup(@Payload() data: { userId: string; groupId: string }) {
    return this.groupQueryService.findById(data.groupId, data.userId);
  }

  @MessagePattern('get_my_groups')
  async searchGroups(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.groupQueryService.getMyGroups(data.userId, data.query);
  }

  @MessagePattern('recommend_groups')
  async recommendGroups(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.groupQueryService.recommendGroups(data.userId, data.query);
  }

  @MessagePattern('create_group')
  async createGroup(@Payload() data: { userId: string; dto: CreateGroupDTO }) {
    return this.groupService.createGroup(data.userId, data.dto);
  }

  @RequireGroupPermission(GroupPermission.UPDATE_GROUP)
  @MessagePattern('update_group')
  async updateGroup(
    @Payload()
    data: {
      userId: string;
      groupId: string;
      dto: Partial<UpdateGroupDTO>;
    },
  ) {
    return this.groupService.updateGroup(data.userId, data.groupId, data.dto);
  }

  @MessagePattern('delete_group')
  @RequireGroupRole(GroupRole.ADMIN)
  async deleteGroup(
    @Payload()
    data: {
      userId: string;
      groupId: string;
    },
  ) {
    return this.groupService.deleteGroup(data.userId, data.groupId);
  }

  @MessagePattern('get_group_user_permissions')
  async getGroupUserPermissions(
    @Payload() data: { userId: string; groupId: string },
  ) {
    return this.groupQueryService.getGroupUserPermissions(
      data.userId,
      data.groupId,
    );
  }

  @MessagePattern('get_group_info_batch')
  async getGroupInfoBatch(@Payload() groupIds: string[]) {
    return this.groupQueryService.getGroupsBatchInfo(groupIds);
  }
}
