import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { EmotionService } from './emotion.service';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { RequireRole } from 'src/common/decorators/require-role.decorator';
import {
  CursorPaginationDTO,
  DashboardQueryDTO,
  EmotionTimeWindow,
  GetDashboardDistributionDto,
  GetDashboardTrendDto,
  SystemRole,
} from '@repo/dtos';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';

@Controller('emotions')
export class EmotionController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.EMOTION_INTELLIGENCE_SERVICE)
    private client: ClientProxy,
    private readonly emotionService: EmotionService,
  ) {}

  @Get('dashboard')
  @RequireRole(SystemRole.ADMIN)
  async getEmotionDashboard(@Query() filter: DashboardQueryDTO) {
    return this.emotionService.getEmotionDashboard(filter);
  }

  @Get('summary')
  async getEmotionDashboardSummary(@CurrentUserId() userId: string) {
    return this.client.send('dashboard.get_summary', { userId });
  }

  @Get('trend')
  async getEmotionDashboardTrend(
    @CurrentUserId() userId: string,
    @Query('window') window: EmotionTimeWindow,
  ) {
    const payload: GetDashboardTrendDto = {
      userId,
      window,
    };
    return this.client.send('dashboard.get_trend', payload);
  }

  @Get('distribution')
  async getEmotionDashboardDistribution(
    @CurrentUserId() userId: string,
    @Query('window') window: EmotionTimeWindow,
  ) {
    const payload: GetDashboardDistributionDto = {
      userId,
      window,
    };
    return this.client.send('dashboard.get_distribution', payload);
  }

  @Get('insights')
  async getEmotionDashboardInsights(@CurrentUserId() userId: string) {
    return this.client.send('dashboard.get_insights', { userId });
  }

  @Get('history')
  async getEmotionHistory(
    @CurrentUserId() userId: string,
    @Query() query: CursorPaginationDTO,
  ) {
    return this.client.send('dashboard.get_history', { userId, query });
  }
}
