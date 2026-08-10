import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GroupLogFilter, GroupPermission } from '@repo/dtos';
import { RequireGroupPermission } from '../group-authorization/require-group-permission.decorator';
import { GroupLogService } from './group-log.service';

@Controller('group-event')
export class GroupLogController {
  constructor(private readonly groupLogService: GroupLogService) {}

  @MessagePattern('get-group-logs')
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
