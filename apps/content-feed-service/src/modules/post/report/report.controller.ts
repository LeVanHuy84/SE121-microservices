import { Controller } from '@nestjs/common';
import { ReportService } from './report.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ContentEntryQuery,
  CreateReportDTO,
  DashboardQueryDTO,
  ReportFilterDTO,
  TargetType,
} from '@repo/dtos';
import { ReadReportService } from './read-report.service';

@Controller('report')
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly readReportService: ReadReportService
  ) {}

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
      targetId: string;
      targetType: TargetType;
      userId: string;
    }
  ) {
    const { targetId, targetType, userId } = payload;
    return await this.reportService.rejectReport(targetId, targetType, userId);
  }

  @MessagePattern('get_post_dashboard')
  async getDashboard(@Payload() filter: DashboardQueryDTO) {
    return this.readReportService.getDashboard(filter);
  }

  @MessagePattern('get_reports')
  async getReports(@Payload() filter: ReportFilterDTO) {
    return await this.readReportService.getReports(filter);
  }

  @MessagePattern('get_content_entry')
  async getContentEntry(@Payload() filter: ContentEntryQuery) {
    return this.readReportService.getContentEntry(filter);
  }

  @MessagePattern('get_content_chart')
  async getContentChart(@Payload() filter: DashboardQueryDTO) {
    return this.readReportService.getContentChart(filter);
  }

  @MessagePattern('get_content_report_chart')
  async getReportChar(@Payload() filter: DashboardQueryDTO) {
    return this.readReportService.getReportChart(filter);
  }
}
