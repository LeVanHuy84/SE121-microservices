import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  FeedbackListQueryDto,
  FeedbackListItemDto,
  FeedbackAccuracySummaryDto,
  PageResponse,
} from '@repo/dtos';
import { FeedbackRepository } from './feedback.repository';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class AdminFeedbackService {
  private readonly logger = new Logger(AdminFeedbackService.name);

  constructor(private readonly repo: FeedbackRepository) {}

  async list(
    query: FeedbackListQueryDto,
  ): Promise<PageResponse<FeedbackListItemDto>> {
    try {
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const res = await this.repo.listFeedbacks(page, limit, query.isAccurate);

      return new PageResponse<FeedbackListItemDto>(
        plainToInstance(FeedbackListItemDto, res.items),
        res.total,
        res.page,
        res.limit,
      );
    } catch (e) {
      this.logger.error('feedback list failed', e);
      throw new RpcException({
        statusCode: 500,
        message: 'FEEDBACK_LIST_FAILED',
      });
    }
  }

  async accuracy(): Promise<FeedbackAccuracySummaryDto> {
    try {
      const res = await this.repo.accuracySummary();
      return res as FeedbackAccuracySummaryDto;
    } catch (e) {
      this.logger.error('feedback accuracy failed', e);
      throw new RpcException({
        statusCode: 500,
        message: 'FEEDBACK_ACCURACY_FAILED',
      });
    }
  }
}
