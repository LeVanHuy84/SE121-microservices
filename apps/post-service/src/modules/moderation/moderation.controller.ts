import { Controller } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminAppealQuery,
  AdminModerationQuery,
  AppealStatus,
  CreateAdminReviewAppealDTO,
  CreateAppealRequestDTO,
  GetMyModerationQuery,
  SystemRole,
} from '@repo/dtos';
import { ModerationAppealService } from './appeal.service';

@Controller('moderation')
export class ModerationController {
  constructor(
    private readonly moderationService: ModerationService,
    private readonly appealService: ModerationAppealService,
  ) {}

  @MessagePattern('moderation.get-my-records')
  async getMyModerationRecords(
    @Payload() payload: { userId: string; query: GetMyModerationQuery },
  ) {
    console.log(
      'Received get-my-moderation-records message with payload:',
      payload,
    );
    const { userId, query } = payload;
    return this.moderationService.getMyModerationRecords(userId, query);
  }

  @MessagePattern('moderation.get-record-detail')
  async getModerationRecordDetail(
    @Payload() payload: { id: string; userId?: string; role?: SystemRole },
  ) {
    const { id, userId, role } = payload;
    return this.moderationService.getModerationRecordDetail(id, userId, role);
  }

  @MessagePattern('moderation.admin.get-records')
  async getModerationRecordByAdmin(@Payload() query: AdminModerationQuery) {
    return this.moderationService.getModerationRecordsByAdmin(query);
  }

  @MessagePattern('moderation.create-appeal')
  async createAppeal(
    @Payload()
    payload: {
      userId: string;
      createAppealDTO: CreateAppealRequestDTO;
    },
  ) {
    const { userId, createAppealDTO } = payload;
    return this.appealService.createAppeal(userId, createAppealDTO);
  }

  @MessagePattern('moderation.admin.review-appeal')
  async adminReviewAppeal(
    @Payload()
    payload: {
      userId: string;
      appealId: string;
      reviewResult: CreateAdminReviewAppealDTO;
    },
  ) {
    const { userId, appealId, reviewResult } = payload;
    return this.appealService.adminReviewAppeal(userId, appealId, reviewResult);
  }

  @MessagePattern('moderation.admin.get-appeals')
  async getListAppeal(@Payload() query: AdminAppealQuery) {
    return this.appealService.getListAppeal(query);
  }

  @MessagePattern('moderation.admin.restore-content')
  async applyFinalDecision(
    @Payload()
    payload: {
      adminId: string;
      moderationId: string;
      status: AppealStatus;
    },
  ) {
    const { adminId, moderationId, status } = payload;
    return this.moderationService.applyFinalDecision(
      moderationId,
      status,
      false,
      adminId,
    );
  }
}
