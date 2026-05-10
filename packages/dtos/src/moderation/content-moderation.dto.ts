import { MediaItemDTO } from '../common';
import {
  CommentResponseDTO,
  PostResponseDTO,
  ShareResponseDTO,
} from '../social';

export class ContentModerationDTO {
  id: string;
  userId: string;
  targetId: string;
  targetType: string;
  isViolation: boolean;
  violations: {
    category: string;
    reason: string;
  }[];
  maxSeverity: string;
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
}
