import { TcpMessagePattern } from '@repo/common';
import { Controller } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { Payload } from '@nestjs/microservices';
import { CreateFeedbackDto, FeedbackResponseDto, TargetType } from '@repo/dtos';

@Controller()
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @TcpMessagePattern('emotion-feedback.create')
  async createFeedback(
    @Payload()
    payload: {
      userId: string;
      data: CreateFeedbackDto;
    },
  ): Promise<FeedbackResponseDto> {
    return this.feedbackService.createFeedback(payload.userId, payload.data);
  }

  @TcpMessagePattern('emotion-feedback.get_by_target')
  async getByTarget(
    @Payload()
    payload: {
      userId: string;
      targetId: string;
      targetType: TargetType;
    },
  ): Promise<FeedbackResponseDto[]> {
    return this.feedbackService.getFeedbackByTarget(
      payload.userId,
      payload.targetId,
      payload.targetType,
    );
  }
}
