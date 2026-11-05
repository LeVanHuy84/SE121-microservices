import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { ReportService } from "./report.service";
import { Payload } from "@nestjs/microservices";
import {
  ContentEntryQuery,
  CreateReportDTO,
  DashboardQueryDTO,
  ReportFilterDTO,
  TargetType,
} from "@repo/dtos";
import { ReadReportService } from "./read-report.service";

@Controller("report")
export class ReportController {
  constructor(
    private readonly reportService: ReportService,
    private readonly readReportService: ReadReportService,
  ) {}

  @TcpMessagePattern("create_report")
  async createReport(
    @Payload() payload: { userId: string; createReportDto: CreateReportDTO },
  ) {
    const { userId, createReportDto } = payload;
    return await this.reportService.createReport(userId, createReportDto);
  }

  @TcpMessagePattern("resolve_report_target")
  async resolveReportTarget(
    @Payload()
    payload: {
      targetId: string;
      targetType: TargetType;
      userId: string;
    },
  ) {
    const { targetId, targetType, userId } = payload;
    return await this.reportService.resolveTarget(targetId, targetType, userId);
  }

  @TcpMessagePattern("reject_report")
  async rejectReport(
    @Payload()
    payload: {
      targetId: string;
      targetType: TargetType;
      userId: string;
    },
  ) {
    const { targetId, targetType, userId } = payload;
    return await this.reportService.rejectReport(targetId, targetType, userId);
  }

  @TcpMessagePattern("get_post_dashboard")
  async getDashboard(@Payload() filter: DashboardQueryDTO) {
    return this.readReportService.getDashboard(filter);
  }

  @TcpMessagePattern("get_reports")
  async getReports(@Payload() filter: ReportFilterDTO) {
    return await this.readReportService.getReports(filter);
  }

  @TcpMessagePattern("get_content_entry")
  async getContentEntry(@Payload() filter: ContentEntryQuery) {
    return this.readReportService.getContentEntry(filter);
  }

  @TcpMessagePattern("get_content_chart")
  async getContentChart(@Payload() filter: DashboardQueryDTO) {
    return this.readReportService.getContentChart(filter);
  }

  @TcpMessagePattern("get_content_report_chart")
  async getReportChar(@Payload() filter: DashboardQueryDTO) {
    return this.readReportService.getReportChart(filter);
  }
}
