import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  FeedbackListQueryDto,
  RiskUsersQueryDto,
  SystemRole,
} from '@repo/dtos';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { RequireRole } from 'src/common/decorators/require-role.decorator';

@Controller('admin/emotion')
export class AdminEmotionController {
  constructor(
    @Inject(MICROSERVICES_CLIENTS.EMOTION_INTELLIGENCE_SERVICE)
    private readonly client: ClientProxy,
  ) {}

  @Get('dashboard')
  @RequireRole(SystemRole.ADMIN)
  async getDashboardOverview() {
    return await firstValueFrom(
      this.client.send('emotion-admin.dashboard.overview', {}),
    );
  }

  @Get('dashboard/charts')
  @RequireRole(SystemRole.ADMIN)
  async getDashboardCharts(@Query() query: { from?: string; to?: string }) {
    return await firstValueFrom(
      this.client.send('emotion-admin.dashboard.chart', query),
    );
  }

  @Get('risk-users')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async listRiskUsers(@Query() query: RiskUsersQueryDto) {
    return await firstValueFrom(
      this.client.send('emotion-admin.profile.risk-users', query),
    );
  }

  @Get('feedbacks')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async listFeedbacks(@Query() query: FeedbackListQueryDto) {
    return await firstValueFrom(
      this.client.send('emotion-admin.feedback.list', query),
    );
  }

  @Get('feedbacks/accuracy')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async feedbackAccuracy() {
    return await firstValueFrom(
      this.client.send('emotion-admin.feedback.accuracy', {}),
    );
  }
}
