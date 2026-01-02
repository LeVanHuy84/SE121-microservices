import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AdminGroupQuery,
  CreateGroupReportDTO,
  GroupReportQuery,
  SystemRole,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { RequireRole } from 'src/common/decorators/require-role.decorator';

@Controller('groups')
export class GroupReportController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.GROUP_SERVICE)
    private client: ClientProxy
  ) {}

  @Post('/group/:groupId/reports')
  createGroupReport(
    @Param('groupId') groupId: string,
    @Body() createGroupReport: CreateGroupReportDTO,
    @CurrentUserId() reporterId: string
  ) {
    return this.client.send('create_group_report', {
      groupId,
      reporterId,
      createGroupReport,
    });
  }

  @Get('/reports')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getGroupReports(@Query() filter: GroupReportQuery) {
    return this.client.send('get_group_reports', filter);
  }

  // domain này có thể bỏ
  @Get('/top-reported')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getTopReportedGroups(@Query('topN') topN: number) {
    return this.client.send('get_top_reported_groups', { topN });
  }

  @Post('/group/:id/ignore')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  ignoreGroupReport(
    @Param('id') groupId: string,
    @CurrentUserId() actorId: string
  ) {
    return this.client.send('ignore_group_report', { groupId, actorId });
  }

  @Post('/group/:id/ban')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  banGroup(@Param('id') groupId: string, @CurrentUserId() actorId: string) {
    return this.client.send('ban_group', { groupId, actorId });
  }

  @Post('/group/:id/unban')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  unbanGroup(@Param('id') groupId: string, @CurrentUserId() actorId: string) {
    return this.client.send('unban_group', { groupId, actorId });
  }

  @Get('admin')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getGroupByAdmin(@Query() filter: AdminGroupQuery) {
    return this.client.send('get_group_by_admin', filter);
  }
}
