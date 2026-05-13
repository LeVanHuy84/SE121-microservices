import { Controller } from '@nestjs/common';
import { EmotionAnalyticsService } from './emotion-analytics.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { TargetType, AnalysisSummaryDto } from '@repo/dtos';

@Controller()
export class EmotionAnalyticsController {
  constructor(
    private readonly emotionAnalyticsService: EmotionAnalyticsService,
  ) {}

  @MessagePattern('emotion-analytics.get_by_target')
  async getByTarget(
    @Payload()
    payload: {
      userId: string;
      targetId: string;
      targetType: TargetType;
    },
  ): Promise<AnalysisSummaryDto> {
    return this.emotionAnalyticsService.getByTarget(payload);
  }
}
