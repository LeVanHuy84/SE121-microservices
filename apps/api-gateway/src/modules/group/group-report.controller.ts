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
import { CreateGroupReportDTO, GroupReportQuery } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

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
  getGroupReports(@Query() filter: GroupReportQuery) {
    return this.client.send('get_group_reports', filter);
  }

  // domain này có thể bỏ
  @Get('/top-reported')
  getTopReportedGroups(@Query('topN') topN: number) {
    return this.client.send('get_top_reported_groups', { topN });
  }
}
