import { Controller, Get, Param, Query } from '@nestjs/common';
import { EmotionService } from './emotion.service';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';

@Controller('emotion')
export class EmotionController {
  constructor(private readonly emotionService: EmotionService) {}

  @Get('detail/:id')
  getDetail(@Param('id') id: string) {
    return this.emotionService.getDetail(id);
  }

  @Get('history')
  getHistory(
    @CurrentUserId() userId: string,
    @Query('preset') preset: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: number
  ) {
    return this.emotionService.getHistory({
      userId,
      preset,
      fromDate,
      toDate,
      cursor,
      limit,
    });
  }

  @Get('summary')
  getSummary(
    @CurrentUserId() userId: string,
    @Query('preset') preset: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string
  ) {
    return this.emotionService.getSummary({
      userId,
      preset,
      fromDate,
      toDate,
    });
  }

  @Get('summary/daily-trend')
  getDailyTrend(
    @CurrentUserId() userId: string,
    @Query('preset') preset = 'week',
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string
  ) {
    return this.emotionService.getDailyTrend({
      userId,
      preset,
      fromDate: fromDate,
      toDate: toDate,
    });
  }

  @Get('summary/by-hour')
  getByHour(@CurrentUserId() userId: string) {
    return this.emotionService.getByHour(userId);
  }
}
