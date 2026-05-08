import { Injectable } from '@nestjs/common';
import {
  AppealStatus,
  EventDestination,
  EventTopic,
  LogEventPayload,
  LogType,
} from '@repo/dtos';
import { Repository } from 'typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { UserClientService } from '../client/user/user-client.service';

@Injectable()
export class LogService {
  constructor(
    private readonly outboxRepo: Repository<OutboxEvent>,
    private readonly userClient: UserClientService,
  ) {}

  async logAdminReviewAppeal(
    moderatorId: string,
    appealId: string,
    status: AppealStatus,
  ): Promise<void> {
    let detailMessage = '';

    const actor = await this.userClient.getUserInfo(moderatorId);
    const actorName =
      `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim();

    if (status === AppealStatus.APPROVED) {
      detailMessage = `Kiểm duyệt viên ${actorName} đã chấp thuận khiếu nại của người dùng và khôi phục nội dung`;
    } else if (status === AppealStatus.REJECTED) {
      detailMessage = `Kiểm duyệt viên ${actorName} đã từ chối khiếu nại của người dùng và giữ nguyên kết quả kiểm duyệt`;
    }

    const logPayload: LogEventPayload = {
      actorId: moderatorId,
      targetId: appealId,
      logType: LogType.MODERATE_LOG,
      action: 'REVIEW_APPEAL',
      detail: detailMessage,
      createdAt: new Date(),
    };

    const loggingOutbox = this.outboxRepo.create({
      topic: EventTopic.LOGGING,
      destination: EventDestination.KAFKA,
      eventType: LogType.MODERATE_LOG,
      payload: logPayload,
    });
    await this.outboxRepo.save(loggingOutbox);
  }

  async logAdminFinalDecision(
    moderatorId: string,
    moderationId: string,
    status: AppealStatus,
  ): Promise<void> {
    let detailMessage = '';

    const actor = await this.userClient.getUserInfo(moderatorId);
    const actorName =
      `${actor?.firstName ?? ''} ${actor?.lastName ?? ''}`.trim();

    if (status === AppealStatus.APPROVED) {
      detailMessage = `Kiểm duyệt viên ${actorName} đã xác nhận nội dung không vi phạm và khôi phục nội dung`;
    } else if (status === AppealStatus.REJECTED) {
      detailMessage = `Kiểm duyệt viên ${actorName} đã xác nhận nội dung vi phạm và ẩn nội dung`;
    }

    const logPayload: LogEventPayload = {
      actorId: moderatorId,
      targetId: moderationId,
      logType: LogType.MODERATE_LOG,
      action: 'FINAL_DECISION',
      detail: detailMessage,
      createdAt: new Date(),
    };

    const loggingOutbox = this.outboxRepo.create({
      topic: EventTopic.LOGGING,
      destination: EventDestination.KAFKA,
      eventType: LogType.MODERATE_LOG,
      payload: logPayload,
    });
    await this.outboxRepo.save(loggingOutbox);
  }
}
