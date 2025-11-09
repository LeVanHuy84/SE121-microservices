import { Controller } from '@nestjs/common';
import { GroupJoinRequestService } from './group-request.service';
import { GroupPermission, JoinRequestFilter } from '@repo/dtos';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { RequireGroupPermission } from '../group-authorization/require-group-permission.decorator';

@Controller('group-request')
export class GroupJoinRequestController {
  constructor(
    private readonly groupJoinRequestService: GroupJoinRequestService,
  ) {}

  // 📨 Gửi yêu cầu tham gia nhóm
  @MessagePattern('request_to_join_group')
  async requestToJoin(@Payload() payload: { groupId: string; userId: string }) {
    return this.groupJoinRequestService.requestToJoin(
      payload.groupId,
      payload.userId,
    );
  }

  // ✅ Duyệt yêu cầu tham gia
  @RequireGroupPermission(GroupPermission.MANAGE_JOIN_REQUESTS)
  @MessagePattern('approve_group_join_request')
  async approveRequest(
    @Payload() payload: { requestId: string; userId: string },
  ) {
    return this.groupJoinRequestService.approveRequest(
      payload.requestId,
      payload.userId,
    );
  }

  // ❌ Từ chối yêu cầu
  @RequireGroupPermission(GroupPermission.MANAGE_JOIN_REQUESTS)
  @MessagePattern('reject_group_join_request')
  async rejectRequest(
    @Payload() payload: { requestId: string; userId: string },
  ) {
    return this.groupJoinRequestService.rejectRequest(
      payload.requestId,
      payload.userId,
    );
  }

  // 🔍 Lọc yêu cầu tham gia nhóm
  @RequireGroupPermission(GroupPermission.MANAGE_JOIN_REQUESTS)
  @MessagePattern('filter_group_join_requests')
  async filterRequests(
    @Payload()
    payload: {
      groupId: string;
      userId: string;
      filter: JoinRequestFilter;
    },
  ) {
    return this.groupJoinRequestService.filterRequests(
      payload.groupId,
      payload.filter,
    );
  }
}
