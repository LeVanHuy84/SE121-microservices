import { Controller } from '@nestjs/common';
import { ReportService } from './report.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminGroupQuery,
  CreateGroupReportDTO,
  DashboardQueryDTO,
  GroupReportQuery,
} from '@repo/dtos';

@Controller('report')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @MessagePattern('get_group_dashboard')
  async getDashboard(@Payload() filter: DashboardQueryDTO) {
    return this.reportService.getDashboard(filter);
  }

  @MessagePattern('create_group_report')
  async createGroupReport(
    @Payload()
    payload: {
      groupId: string;
      reporterId: string;
      createGroupReport: CreateGroupReportDTO;
    },
  ) {
    return this.reportService.createReport(
      payload.groupId,
      payload.reporterId,
      payload.createGroupReport,
    );
  }

  @MessagePattern('get_group_reports')
  async getReportsByGroup(@Payload() filter: GroupReportQuery) {
    return this.reportService.getReports(filter);
  }

  @MessagePattern('get_top_reported_groups')
  async getTopReportedGroups(@Payload() data: { topN: number }) {
    const { topN } = data;
    return this.reportService.getTopReportedGroups(topN);
  }

  @MessagePattern('ignore_group_report')
  async ignoreGroupReports(
    @Payload() data: { groupId: string; actorId: string },
  ) {
    return this.reportService.ignoreGroupReports(data.groupId, data.actorId);
  }

  @MessagePattern('ban_group')
  async banGroup(@Payload() data: { groupId: string; actorId: string }) {
    return this.reportService.banGroup(data.groupId, data.actorId);
  }

  @MessagePattern('unban_group')
  async unbanGroup(@Payload() data: { groupId: string; actorId: string }) {
    return this.reportService.unbanGroup(data.groupId, data.actorId);
  }

  @MessagePattern('get_group_by_admin')
  async getGroupByAdmin(@Payload() data: AdminGroupQuery) {
    return this.reportService.getGroupByAdmin(data);
  }

  @MessagePattern('get_group_report_chart')
  async getGroupReportChart(@Payload() filter: DashboardQueryDTO) {
    return this.reportService.getReportChart(filter);
  }
}
