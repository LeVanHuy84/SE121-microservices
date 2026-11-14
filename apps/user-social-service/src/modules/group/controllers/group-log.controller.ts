import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { GroupLogFilter, GroupPermission } from "@repo/dtos";
import { RequireGroupPermission } from "../decorators/require-group-permission.decorator";
import { GroupLogService } from "../services/group-log.service";

@Controller("group-event")
export class GroupLogController {
  constructor(private readonly groupLogService: GroupLogService) {}

  @TcpMessagePattern("get-group-logs")
  @RequireGroupPermission(GroupPermission.VIEW_SETTINGS)
  async getGroupLogs(
    @Payload()
    payload: {
      groupId: string;
      filter: GroupLogFilter;
      userId: string;
    },
  ) {
    const { groupId, filter } = payload;
    return this.groupLogService.getLogsByGroupId(groupId, filter);
  }
}
