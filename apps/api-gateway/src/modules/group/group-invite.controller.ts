import { Controller, Inject, Param, Post, Get } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('groups/:groupId/invites')
export class GroupInviteController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private readonly client: ClientProxy
  ) {}

  // ✅ Accept invite
  @Post('/accept')
  async acceptInvite(
    @Param('groupId') groupId: string,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('accept_group_invite', {
      groupId,
      userId,
    });
  }

  // ❌ Decline invite
  @Post('/decline')
  async declineInvite(
    @Param('groupId') groupId: string,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('decline_group_invite', {
      groupId,
      userId,
    });
  }

  // 📩 Invite user vào group
  @Post(':inviteeId')
  async inviteUser(
    @Param('groupId') groupId: string,
    @Param('inviteeId') inviteeId: string,
    @CurrentUserId() inviterId: string
  ) {
    return this.client.send('invite_user_to_group', {
      groupId,
      inviterId,
      inviteeId,
    });
  }
}
