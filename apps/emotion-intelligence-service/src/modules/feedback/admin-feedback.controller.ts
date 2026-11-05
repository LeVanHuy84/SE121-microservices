import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { AdminFeedbackService } from './admin-feedback.service';
import {
  FeedbackAccuracySummaryDto,
  FeedbackListItemDto,
  FeedbackListQueryDto,
  PageResponse,
} from '@repo/dtos';

@Controller()
export class AdminFeedbackController {
  constructor(private readonly adminService: AdminFeedbackService) {}

  @TcpMessagePattern('emotion-admin.feedback.list')
  async list(
    @Payload() query: FeedbackListQueryDto,
  ): Promise<PageResponse<FeedbackListItemDto>> {
    return this.adminService.list(query);
  }

  @TcpMessagePattern('emotion-admin.feedback.accuracy')
  async accuracy(): Promise<FeedbackAccuracySummaryDto> {
    return this.adminService.accuracy();
  }
}
