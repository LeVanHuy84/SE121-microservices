import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GroupService } from './group.service';
import {
  CreateGroupDTO,
  GroupPermission,
  SearchGroupDTO,
  UpdateGroupDTO,
} from '@repo/dtos';
import { RequireGroupPermission } from 'src/modules/group-authorization/require-group-permission.decorator';

@Controller('group')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @MessagePattern('health_check')
  async healthCheck() {
    return { status: 'ok' };
  }

  @MessagePattern('find_group_by_id')
  async getGroup(@Payload() data: { groupId: string }) {
    return this.groupService.findById(data.groupId);
  }

  @MessagePattern('search_groups')
  async searchGroups(@Payload() data: { query: SearchGroupDTO }) {
    return this.groupService.search(data.query);
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

  @RequireGroupPermission(GroupPermission.DELETE_GROUP)
  @MessagePattern('delete_group')
  async deleteGroup(
    @Payload()
    data: {
      userId: string;
      groupId: string;
    },
  ) {
    return this.groupService.deleteGroup(data.userId, data.groupId);
  }

  @MessagePattern('check_before_create_post')
  async checkBeforeCreatePost(
    @Payload()
    payload: {
      groupId: string;
      userId: string;
    },
  ) {
    return this.groupService.checkBeforeCreatePost(
      payload.groupId,
      payload.userId,
    );
  }

  @MessagePattern('can_user_view_group_posts')
  async canUserViewGroupPosts(
    @Payload()
    payload: {
      groupId: string;
      userId: string;
    },
  ) {
    return this.groupService.canUserViewGroupPosts(
      payload.groupId,
      payload.userId,
    );
  }

  @MessagePattern('can_user_approve_post')
  async canUserApprovePost(
    @Payload()
    payload: {
      groupId: string;
      userId: string;
    },
  ) {
    return true;
  }
}
