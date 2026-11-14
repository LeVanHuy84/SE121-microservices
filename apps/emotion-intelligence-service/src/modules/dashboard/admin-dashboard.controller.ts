import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { AdminDashboardService } from './admin-dashboard.service';
import {
  DashboardOverviewResponseDto,
  EmotionDashboardChartItemDto,
} from '@repo/dtos';

@Controller()
export class AdminDashboardController {
  constructor(private readonly adminService: AdminDashboardService) {}

  @TcpMessagePattern('emotion-admin.dashboard.overview')
  async getOverview(
    @Payload() _payload: any,
  ): Promise<DashboardOverviewResponseDto> {
    return this.adminService.getOverview();
  }

  @TcpMessagePattern('emotion-admin.dashboard.chart')
  async getDashboardChart(
    @Payload()
    payload: {
      from?: string;
      to?: string;
    },
  ): Promise<EmotionDashboardChartItemDto[]> {
    return this.adminService.getDashboardChart(payload);
  }
}
