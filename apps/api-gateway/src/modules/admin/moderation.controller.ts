import {
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  AdminAppealQuery,
  AdminModerationQuery,
  AppealStatus,
  CreateAdminReviewAppealDTO,
  CreateAppealRequestDTO,
  GetMyModerationQuery,
  SystemRole,
} from '@repo/dtos';

import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { CurrentUserId } from 'src/common/decorators/current-user-id.decorator';
import { RequireRole } from 'src/common/decorators/require-role.decorator';

@Controller('moderations')
export class ModerationController {
  private readonly logger = new Logger(ModerationController.name);

  constructor(
    @Inject(MICROSERVICES_CLIENTS.POST_SERVICE)
    private readonly postClient: ClientProxy,
  ) {}

  // =========================================================
  // USER APIs
  // =========================================================

  @Get('me')
  async getMyModerationRecords(
    @CurrentUserId() userId: string,
    @Query() query: GetMyModerationQuery,
  ) {
    return this.postClient.send('moderation.get-my-records', {
      userId,
      query,
    });
  }

  @Get('records/:id')
  async getModerationRecordDetail(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
  ) {
    console.log(
      'Fetching moderation record detail for id:',
      id,
      'and userId:',
      userId,
    );
    return this.postClient.send('moderation.get-record-detail', {
      id,
      userId,
    });
  }

  // =========================================================
  // APPEAL APIs
  // =========================================================

  @Post('appeals')
  async createAppeal(
    @CurrentUserId() userId: string,
    @Body() body: CreateAppealRequestDTO,
  ) {
    return this.postClient.send('moderation.create-appeal', {
      userId,
      createAppealDTO: body,
    });
  }

  // =========================================================
  // ADMIN APIs
  // =========================================================

  @Get('admin/records')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async getAdminModerationRecords(@Query() query: AdminModerationQuery) {
    return this.postClient.send('moderation.admin.get-records', query);
  }

  @Get('admin/records/:id')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async getAdminModerationRecordDetail(@Param('id') id: string) {
    console.log(`Admin fetching moderation record detail for id=${id}`);
    return this.postClient.send('moderation.get-record-detail', {
      id,
      userId: null,
      role: SystemRole.ADMIN,
    });
  }

  @Get('admin/appeals')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async getAdminAppeals(@Query() query: AdminAppealQuery) {
    return this.postClient.send('moderation.admin.get-appeals', query);
  }

  @Patch('admin/appeals/:appealId')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async reviewAppeal(
    @CurrentUserId() userId: string,
    @Param('appealId') appealId: string,
    @Body() body: CreateAdminReviewAppealDTO,
  ) {
    return this.postClient.send('moderation.admin.review-appeal', {
      userId,
      appealId,
      reviewResult: body,
    });
  }

  @Post(':moderationId/restore')
  @RequireRole(SystemRole.ADMIN, SystemRole.MODERATOR)
  async restoreModeratedContent(
    @CurrentUserId() adminId: string,
    @Param('moderationId') moderationId: string,
    @Body() body: { status: AppealStatus },
  ) {
    return this.postClient.send('moderation.admin.restore-content', {
      moderationId,
      adminId,
      status: body.status,
    });
  }
}
