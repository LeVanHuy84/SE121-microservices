import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GroupInviteService } from './group-invite.service';
import { RequireGroupPermission } from '../group-authorization/require-group-permission.decorator';
import { GroupPermission } from '@repo/dtos';

@Controller('group-invite')
export class GroupInviteController {
  constructor(private readonly groupInviteService: GroupInviteService) {}

  // 📩 Mời user vào group
  //   @RequireGroupPermission(GroupPermission.INVITE_MEMBERS)
  @MessagePattern('invite_user_to_group')
  async invite(
    @Payload()
    payload: {
      groupId: string;
      inviterId: string;
      inviteeId: string;
    },
  ) {
    return this.groupInviteService.invite(
      payload.groupId,
      payload.inviterId,
      payload.inviteeId,
    );
  }

  // ✅ Accept invite
  @MessagePattern('accept_group_invite')
  async acceptInvite(@Payload() payload: { groupId: string; userId: string }) {
    return this.groupInviteService.acceptInvite(
      payload.groupId,
      payload.userId,
    );
  }

  // ❌ Decline invite
  @MessagePattern('decline_group_invite')
  async declineInvite(@Payload() payload: { groupId: string; userId: string }) {
    return this.groupInviteService.declineInvite(
      payload.groupId,
      payload.userId,
    );
  }
}
