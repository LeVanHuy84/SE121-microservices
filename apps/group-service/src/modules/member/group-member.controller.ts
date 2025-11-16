import { Controller } from '@nestjs/common';
import { GroupMemberService } from './group-member.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GroupMemberFilter, GroupPermission, GroupRole } from '@repo/dtos';

@Controller('member')
export class GroupMemberController {
  constructor(private readonly groupMemberService: GroupMemberService) {}

  @MessagePattern('remove-member')
  async removeMember(
    @Payload() payload: { groupId: string; memberId: string; userId: string },
  ) {
    return this.groupMemberService.removeMember(
      payload.groupId,
      payload.memberId,
    );
  }

  @MessagePattern('ban-member')
  async banMember(
    @Payload() payload: { groupId: string; memberId: string; userId: string },
  ) {
    return this.groupMemberService.banMember(payload.groupId, payload.memberId);
  }

  @MessagePattern('change-member-role')
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
      payload.groupId,
      payload.newRole,
      payload.memberId,
    );
  }

  @MessagePattern('change-member-permission')
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

  @MessagePattern('get-member-by-filter')
  async getMembers(
    @Payload()
    payload: {
      groupId: string;
      filter: GroupMemberFilter;
    },
  ) {
    return this.groupMemberService.getMembers(payload.groupId, payload.filter);
  }

  @MessagePattern('get_group_member_user_ids')
  async getMemberUserIds(
    @Payload() payload: { groupId: string },
  ): Promise<string[]> {
    const result = await this.groupMemberService.getMemberUserIds(
      payload.groupId,
    );
    console.log('Group member user IDs:', result);
    return result;
  }
}
