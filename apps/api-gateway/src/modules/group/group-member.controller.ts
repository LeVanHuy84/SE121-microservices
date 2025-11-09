import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { GroupMemberFilter, GroupPermission, GroupRole } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('groups/:groupId/members')
export class GroupMemberController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private client: ClientProxy
  ) {}

  @Put(':memberId/remove')
  async removeMember(
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('remove-member', { groupId, memberId, userId });
  }

  @Put(':memberId/ban')
  async banMember(
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('ban-member', { groupId, memberId, userId });
  }

  @Put(':memberId/change-role')
  async changeRole(
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
    @Body('newRole') newRole: GroupRole,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('change-member-role', {
      groupId,
      memberId,
      newRole,
      userId,
    });
  }

  @Put(':memberId/change-permission')
  async changePermission(
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
    @Body('permissions') permissions: GroupPermission[],
    @CurrentUserId() userId: string
  ) {
    return this.client.send('change-member-permission', {
      groupId,
      memberId,
      permissions,
      userId,
    });
  }

  @Get()
  async getMembers(
    @Param('groupId') groupId: string,
    @Query() filter: GroupMemberFilter,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('get-member-by-filter', {
      groupId,
      filter,
      userId,
    });
  }
}
