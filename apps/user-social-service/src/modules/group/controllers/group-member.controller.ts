import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { GroupMemberService } from "../services/group-member.service";
import { Payload } from "@nestjs/microservices";
import { GroupMemberFilter, GroupPermission, GroupRole } from "@repo/dtos";
import { RequireGroupPermission } from "../decorators/require-group-permission.decorator";
import { RequireGroupRole } from "../decorators/require-group-role.decatator";

@Controller("member")
export class GroupMemberController {
  constructor(private readonly groupMemberService: GroupMemberService) {}

  @TcpMessagePattern("leave-group")
  async leaveGroup(@Payload() payload: { groupId: string; userId: string }) {
    return this.groupMemberService.leaveGroup(payload.userId, payload.groupId);
  }

  @TcpMessagePattern("remove-member")
  @RequireGroupPermission(GroupPermission.MANAGE_MEMBERS)
  async removeMember(
    @Payload() payload: { groupId: string; memberId: string; userId: string },
  ) {
    return this.groupMemberService.removeMember(
      payload.userId,
      payload.groupId,
      payload.memberId,
    );
  }

  @TcpMessagePattern("ban-member")
  @RequireGroupPermission(GroupPermission.BAN_MEMBER)
  async banMember(
    @Payload() payload: { groupId: string; memberId: string; userId: string },
  ) {
    return this.groupMemberService.banMember(
      payload.userId,
      payload.groupId,
      payload.memberId,
    );
  }

  @TcpMessagePattern("unban-member")
  @RequireGroupPermission(GroupPermission.BAN_MEMBER)
  async unbanMember(
    @Payload() payload: { groupId: string; memberId: string; userId: string },
  ) {
    return this.groupMemberService.unbanMember(
      payload.userId,
      payload.groupId,
      payload.memberId,
    );
  }

  @TcpMessagePattern("change-member-role")
  // @RequireGroupRole(GroupRole.ADMIN)
  @RequireGroupPermission(GroupPermission.MANAGE_MEMBERS)
  async changeRole(
    @Payload()
    payload: {
      groupId: string;
      newRole: GroupRole;
      memberId: string;
      userId: string;
    },
  ) {
    return this.groupMemberService.changeRole(
      payload.userId,
      payload.groupId,
      payload.newRole,
      payload.memberId,
    );
  }

  @TcpMessagePattern("change-member-permission")
  @RequireGroupRole(GroupRole.ADMIN)
  async changePermission(
    @Payload()
    payload: {
      groupId: string;
      memberId: string;
      permissions: GroupPermission[];
      userId: string;
    },
  ) {
    return this.groupMemberService.addPermission(
      payload.groupId,
      payload.memberId,
      payload.permissions,
    );
  }

  @TcpMessagePattern("get-member-by-filter")
  async getMembers(
    @Payload()
    payload: {
      groupId: string;
      filter: GroupMemberFilter;
    },
  ) {
    return this.groupMemberService.getMembers(payload.groupId, payload.filter);
  }

  @TcpMessagePattern("get_group_member_user_ids")
  async getMemberUserIds(
    @Payload() payload: { groupId: string },
  ): Promise<string[]> {
    return await this.groupMemberService.getMemberUserIds(payload.groupId);
  }
}
