import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { GroupJoinRequestService } from "../services/group-request.service";
import { GroupPermission, JoinRequestFilter } from "@repo/dtos";
import { Payload } from "@nestjs/microservices";
import { RequireGroupPermission } from "../decorators/require-group-permission.decorator";
import { GroupJoinRequestQueryService } from "../services/group-request-query.service";

@Controller("group-request")
export class GroupJoinRequestController {
  constructor(
    private readonly groupJoinRequestService: GroupJoinRequestService,
    private readonly groupJoinRequestQueryService: GroupJoinRequestQueryService,
  ) {}

  // 📨 Gửi yêu cầu tham gia nhóm
  @TcpMessagePattern("request_to_join_group")
  async requestToJoin(@Payload() payload: { groupId: string; userId: string }) {
    return this.groupJoinRequestService.requestToJoin(
      payload.groupId,
      payload.userId,
    );
  }

  // ✅ Duyệt yêu cầu tham gia
  @RequireGroupPermission(GroupPermission.MANAGE_JOIN_REQUESTS)
  @TcpMessagePattern("approve_group_join_request")
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
  @TcpMessagePattern("reject_group_join_request")
  async rejectRequest(
    @Payload() payload: { requestId: string; userId: string },
  ) {
    return this.groupJoinRequestService.rejectRequest(
      payload.requestId,
      payload.userId,
    );
  }

  // 🛑 Hủy yêu cầu tham gia nhóm
  @TcpMessagePattern("cancel_group_join_request")
  async cancelRequest(
    @Payload() payload: { requestId: string; userId: string },
  ) {
    return this.groupJoinRequestService.cancelRequest(
      payload.requestId,
      payload.userId,
    );
  }

  // 🔍 Lọc yêu cầu tham gia nhóm
  @RequireGroupPermission(GroupPermission.MANAGE_JOIN_REQUESTS)
  @TcpMessagePattern("filter_group_join_requests")
  async filterRequests(
    @Payload()
    payload: {
      groupId: string;
      userId: string;
      filter: JoinRequestFilter;
    },
  ) {
    return this.groupJoinRequestQueryService.filterRequests(
      payload.groupId,
      payload.filter,
    );
  }
}
