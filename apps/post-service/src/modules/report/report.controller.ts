import { Controller } from '@nestjs/common';
import { ReportService } from './report.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateReportDTO, ReportFilterDTO, TargetType } from '@repo/dtos';

@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @MessagePattern('create_report')
  async createReport(
    @Payload() payload: { userId: string; createReportDto: CreateReportDTO }
  ) {
    const { userId, createReportDto } = payload;
    return await this.reportService.createReport(userId, createReportDto);
  }

  @MessagePattern('resolve_report_target')
  async resolveReportTarget(
    @Payload()
    payload: {
      targetId: string;
      targetType: TargetType;
      userId: string;
    }
  ) {
    const { targetId, targetType, userId } = payload;
    return await this.reportService.resolveTarget(targetId, targetType, userId);
  }

  @MessagePattern('reject_report')
  async rejectReport(
    @Payload()
    payload: {
      reportId: string;
      userId: string;
    }
  ) {
    const { reportId, userId } = payload;
    return await this.reportService.rejectReport(reportId, userId);
  }

  @MessagePattern('get_reports')
  async getReports(
    @Payload()
    payload: {
      filterDto: ReportFilterDTO;
    }
  ) {
    const { filterDto } = payload;
    return await this.reportService.getReports(filterDto);
  }
}
