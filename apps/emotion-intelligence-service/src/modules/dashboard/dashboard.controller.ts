import { Controller } from '@nestjs/common';
import { MessagePattern, Payload, RpcException } from '@nestjs/microservices';
import {
  DashboardInsightsResponseDto,
  DashboardDistributionResponseDto,
  DashboardSummaryResponseDto,
  DashboardTrendResponseDto,
  GetDashboardDistributionDto,
  GetDashboardTrendDto,
  CursorPageResponse,
  CursorPaginationDTO,
  EmotionHistoryItemDto,
} from '@repo/dtos';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @MessagePattern('dashboard.get_summary')
  async getSummary(
    @Payload() payload: { userId: string },
  ): Promise<DashboardSummaryResponseDto> {
    return this.dashboardService.getSummary(payload.userId);
  }

  @MessagePattern('dashboard.get_trend')
  async getTrend(
    @Payload() payload: GetDashboardTrendDto,
  ): Promise<DashboardTrendResponseDto> {
    return this.dashboardService.getTrend(payload);
  }

  @MessagePattern('dashboard.get_distribution')
  async getDistribution(
    @Payload() payload: GetDashboardDistributionDto,
  ): Promise<DashboardDistributionResponseDto> {
    return this.dashboardService.getDistribution(payload);
  }

  @MessagePattern('dashboard.get_insights')
  async getInsights(
    @Payload() payload: { userId: string },
  ): Promise<DashboardInsightsResponseDto> {
    return this.dashboardService.getInsights(payload.userId);
  }

  @MessagePattern('dashboard.get_history')
  async getHistory(
    @Payload() payload: { userId: string; query: CursorPaginationDTO },
  ): Promise<CursorPageResponse<EmotionHistoryItemDto>> {
    return this.dashboardService.getHistory(payload.userId, payload.query);
  }
}
