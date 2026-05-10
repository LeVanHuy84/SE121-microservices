import { AppealStatus } from './enums';

export class ModerationAppealResponseDTO {
  id: string;
  moderationId: string;
  userId: string;
  reason: string;
  status: AppealStatus;
  reviewedBy: string;
  reviewNote: string;
  reviewedAt: Date;
  createdAt: Date;
}
