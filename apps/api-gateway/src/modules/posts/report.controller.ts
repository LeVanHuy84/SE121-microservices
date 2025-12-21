import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CreateReportDTO,
  ReportFilterDTO,
  SystemRole,
  TargetType,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { RequireRole } from 'src/common/decorators/require-role.decorator';

@Controller('posts/reports')
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
    @Body() payload: { targetId: string; targetType: TargetType }
  ) {
    const { targetId, targetType } = payload;
    return this.client.send('resolve_report_target', {
      targetId,
      targetType,
      userId,
    });
  }

  @Post('/reject')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  rejectReport(
    @CurrentUserId() userId: string,
    @Body() payload: { targetId: string; targetType: TargetType }
  ) {
    const { targetId, targetType } = payload;
    return this.client.send('reject_report', {
      targetId,
      targetType,
      userId,
    });
  }

  @Get()
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  getReports(@Query() filter: ReportFilterDTO) {
    return this.client.send('get_reports', filter);
  }
}
