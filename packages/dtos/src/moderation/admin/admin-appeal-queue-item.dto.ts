import { MediaItemDTO } from '../../common';
import { Severity, TargetType } from '../../social';
import { AppealStatus } from '../enums';

export class AdminAppealQueueItemDTO {
  id: string;

  moderationId: string;

  userId: string;

  reason: string;

  status: AppealStatus;

  reviewedBy?: string;

  reviewNote?: string;

  reviewedAt?: Date;

  createdAt: Date;

  moderation: {
    targetType: TargetType;

    maxSeverity: Severity;

    confidence: number;

    displayMessage: string;

    finalDecision?: string;
  };

  targetPreview?: {
    content?: string;

    imageUrl?: MediaItemDTO;
  };

  appealCount?: number;
}
