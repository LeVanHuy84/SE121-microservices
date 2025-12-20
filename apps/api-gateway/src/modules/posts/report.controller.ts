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
  ContentEntryQuery,
  CreateReportDTO,
  ReportFilterDTO,
  SystemRole,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { RequireRole } from 'src/common/decorators/require-role.decorator';

@Controller('reports')
export class ReportController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE) private client: ClientProxy
  ) {}

  @Post()
  createReport(
    @CurrentUserId() userId: string,
    @Body() createReportDto: CreateReportDTO
  ) {
    return this.client.send('create_report', { userId, createReportDto });
  }

  @Post('resolve')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  resolveReportTarget(
    @CurrentUserId() userId: string,
    @Body() payload: { targetId: string; targetType: string }
  ) {
    const { targetId, targetType } = payload;
    return this.client.send('resolve_report_target', {
      targetId,
      targetType,
      userId,
    });
  }

  @Post('/:reportId/reject')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  rejectReport(
    @CurrentUserId() userId: string,
    @Param('reportId') reportId: string
  ) {
    return this.client.send('reject_report', {
      reportId,
      userId,
    });
  }

  @Get()
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getReports(@Query() filter: ReportFilterDTO) {
    return this.client.send('get_reports', filter);
  }

  @Get('entry')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getContentEntry(@Query() filter: ContentEntryQuery) {
    return this.client.send('get_content_entry', filter);
  }
}
