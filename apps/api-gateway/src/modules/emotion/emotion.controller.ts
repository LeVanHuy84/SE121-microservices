import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import {
  CreateFeedbackDto,
  CursorPaginationDTO,
  EmotionTimeWindow,
  GetDashboardDistributionDto,
  GetDashboardTrendDto,
  TargetType,
} from '@repo/dtos';
import { ClientProxy } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { firstValueFrom } from 'rxjs';

@Controller('emotions')
export class EmotionController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.EMOTION_INTELLIGENCE_SERVICE)
    private client: ClientProxy,
  ) {}

  @Get('interventions/history')
  async getUserInterventionHistory(
    @CurrentUserId() userId: string,
    @Query('limit') limit?: number,
  ) {
    return await firstValueFrom(
      this.client.send('emotion.intervention.history', {
        userId,
        limit: limit ? Number(limit) : 20,
      }),
    );
  }

  @Get('interventions/:id')
  async getUserInterventionById(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    return await firstValueFrom(
      this.client.send('emotion.intervention.get_by_id', {
        userId,
        id,
      }),
    );
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

  @Get(':targetType/:targetId')
  async getEmotionAnalysis(
    @CurrentUserId() userId: string,
    @Param('targetType') targetType: TargetType,
    @Param('targetId') targetId: string,
  ) {
    return this.client.send('emotion-analytics.get_by_target', {
      userId,
      targetId,
      targetType,
    });
  }

  @Post('feedback')
  async submitFeedback(
    @CurrentUserId() userId: string,
    @Body() createFeedbackDto: CreateFeedbackDto,
  ) {
    return this.client.send('emotion-feedback.create', {
      userId,
      data: createFeedbackDto,
    });
  }

  @Get('feedback/:targetType/:targetId')
  async getFeedbackByTarget(
    @CurrentUserId() userId: string,
    @Param('targetType') targetType: TargetType,
    @Param('targetId') targetId: string,
  ) {
    return this.client.send('emotion-feedback.get_by_target', {
      userId,
      targetId,
      targetType,
    });
  }
}
