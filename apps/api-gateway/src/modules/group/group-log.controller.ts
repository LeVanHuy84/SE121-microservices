import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { GroupLogFilter } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('groups/:groupId/logs')
export class GroupLogController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private readonly client: ClientProxy
  ) {}

  @Get()
  async getGroupLogs(
    @Param('groupId') groupId: string,
    @Query() filter: GroupLogFilter,
    @CurrentUserId() userId: string
  ) {
    return this.client.send('get-group-logs', { groupId, filter, userId });
  }
}
