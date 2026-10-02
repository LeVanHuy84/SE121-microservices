import { MediaItemDTO } from '../common';
import {
  CommentResponseDTO,
  PostResponseDTO,
  ShareResponseDTO,
} from '../social';
import { ModerationAction, ModerationLabel, Severity } from '../social/enums';
import { ModerationAppealResponseDTO } from './appeal.response';

export class ContentModerationDTO {
  id: string;
  userId: string;
  targetId: string;
  targetType: string;
  isViolation: boolean;
  action?: ModerationAction;
  label?: ModerationLabel;
  mentalHealthSupport?: boolean;
  violations: {
    category: string;
    reason: string;
  }[];
  maxSeverity: Severity | string;
  confidence: number;
  displayMessage: string;
  finalDecision?: string;
  createdAt: Date;

  targetPreview?: {
    content?: string;
    imageUrl?: MediaItemDTO;
  };
}

export class ModerationRecordDetailDTO {
  moderation: ContentModerationDTO;
  target: CommentResponseDTO | PostResponseDTO | ShareResponseDTO | null;
  appeals: ModerationAppealResponseDTO[];
}

