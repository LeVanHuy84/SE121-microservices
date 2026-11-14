import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { GroupService } from "../services/group.service";
import {
  CreateGroupDTO,
  CursorPaginationDTO,
  GroupPermission,
  GroupRole,
  UpdateGroupDTO,
} from "@repo/dtos";
import { RequireGroupPermission } from "src/modules/group/decorators/require-group-permission.decorator";
import { RequireGroupRole } from "src/modules/group/decorators/require-group-role.decatator";
import { GroupQueryService } from "../services/group-query.service";
import { GroupHelperService } from "../services/group-helper.service";

@Controller("group")
export class GroupController {
  constructor(
    private readonly groupService: GroupService,
    private readonly groupQueryService: GroupQueryService,
    private readonly groupHelperService: GroupHelperService,
  ) {}

  @TcpMessagePattern("health_check")
  async healthCheck() {
    return { status: "ok" };
  }

  @TcpMessagePattern("find_group_by_id")
  async getGroup(@Payload() data: { userId: string; groupId: string }) {
    return this.groupQueryService.findById(data.groupId, data.userId);
  }

  @TcpMessagePattern("get_my_groups")
  async searchGroups(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.groupQueryService.getMyGroups(data.userId, data.query);
  }

  @TcpMessagePattern("recommend_groups")
  async recommendGroups(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.groupQueryService.recommendGroups(data.userId, data.query);
  }

  @TcpMessagePattern("get_invited_groups")
  async getInvitedGroups(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.groupQueryService.getInvitedGroups(data.userId, data.query);
  }

  @TcpMessagePattern("create_group")
  async createGroup(@Payload() data: { userId: string; dto: CreateGroupDTO }) {
    return this.groupService.createGroup(data.userId, data.dto);
  }

  @RequireGroupPermission(GroupPermission.UPDATE_GROUP)
  @TcpMessagePattern("update_group")
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

  @TcpMessagePattern("delete_group")
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

  @TcpMessagePattern("get_group_user_permissions")
  async getGroupUserPermissions(
    @Payload() data: { userId: string; groupId: string },
  ) {
    return this.groupHelperService.getGroupUserPermissions(
      data.userId,
      data.groupId,
    );
  }

  @TcpMessagePattern("get_group_info_batch")
  async getGroupInfoBatch(@Payload() groupIds: string[]) {
    return this.groupHelperService.getGroupsBatchInfo(groupIds);
  }
}
