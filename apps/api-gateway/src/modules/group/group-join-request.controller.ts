import {
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { JoinRequestFilter } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('groups/:groupId/join-requests')
export class GroupJoinRequestController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private readonly client: ClientProxy
  ) {}

  // User gửi yêu cầu tham gia group
  @Post()
  async requestToJoinGroup(
    @Param('groupId') groupId: string,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('request_to_join_group', { groupId, userId });
  }

  // Admin duyệt yêu cầu
  @Patch(':requestId/approve')
  async approveJoinRequest(
    @Param('groupId') groupId: string,
    @Param('requestId') requestId: string,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('approve_group_join_request', {
      groupId,
      requestId,
      userId,
    });
  }

  // Admin từ chối yêu cầu
  @Patch(':requestId/reject')
  async rejectJoinRequest(
    @Param('groupId') groupId: string,
    @Param('requestId') requestId: string,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('reject_group_join_request', {
      groupId,
      requestId,
      userId,
    });
  }

  // Admin xem danh sách request
  @Get()
  async listRequests(
    @Param('groupId') groupId: string,
    @CurrentUserId() userId: string,
    @Query() filter: JoinRequestFilter
  ) {
    return this.client.send('filter_group_join_requests', {
      groupId,
      userId,
      filter,
    });
  }
}
