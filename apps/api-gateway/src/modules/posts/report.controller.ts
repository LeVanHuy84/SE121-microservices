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
import { CreateReportDTO, ReportFilterDTO } from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

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
  getReports(@Query() filterDto: ReportFilterDTO) {
    return this.client.send('get_reports', { filterDto });
  }
}
