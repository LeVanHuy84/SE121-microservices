import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { DashboardRepository } from './dashboard.repository';
import {
  DashboardOverviewResponseDto,
  EmotionDashboardChartItemDto,
} from '@repo/dtos';

@Injectable()
export class AdminDashboardService {
  private readonly logger = new Logger(AdminDashboardService.name);

  constructor(private readonly repo: DashboardRepository) {}

  async getOverview(): Promise<DashboardOverviewResponseDto> {
    try {
      const data = await this.repo.getOverview();
      return data as DashboardOverviewResponseDto;
    } catch (e) {
      this.logger.error('Overview aggregate failed', e);
      throw new RpcException({ statusCode: 500, message: 'OVERVIEW_FAILED' });
    }
  }

  async getDashboardChart(payload: {
    from?: string;
    to?: string;
  }): Promise<EmotionDashboardChartItemDto[]> {
    try {
      const data = await this.repo.getDashboardChart(payload);
      return data as EmotionDashboardChartItemDto[];
    } catch (e) {
      this.logger.error('Dashboard chart failed', e);

      throw new RpcException({
        statusCode: 500,
        message: 'DASHBOARD_CHART_FAILED',
      });
    }
  }
}
