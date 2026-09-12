import { RiskLevel, TriggerFlag } from './enums';
import { InterventionMediaType, TargetRiskLevel } from './admin-intervention.dto';

export enum SuggestedInterventionAction {
  NO_ACTION = 'NO_ACTION',
  PLAYLIST_AND_TIPS = 'PLAYLIST_AND_TIPS',
  MEDICAL_DOCUMENT = 'MEDICAL_DOCUMENT',
  CHATBOT_COMPANION = 'CHATBOT_COMPANION',
  CRISIS_HOTLINE = 'CRISIS_HOTLINE',
}

export interface MusicSuggestionItemDto {
  trackId?: string;
  title: string;
  artist?: string;
  genre?: string;
  moodTarget: string;
  audioUrl?: string;
  coverUrl?: string;
}

export interface InterventionResourceItemDto {
  id: string;
  title: string;
  description: string;
  targetRiskLevels?: TargetRiskLevel[];
  mediaType: InterventionMediaType;
  mediaUrl: string;
  sourceOrganization?: string;
  referenceUrl?: string;
  thumbnailUrl?: string;
}

export class EmergencyHotlineItemDto {
  id?: string;
  organizationName: string;
  hotlineNumber: string;
  is247?: boolean;
  operatingHours?: string;
  operatingHoursConfig?: {
    is247?: boolean;
    startTime?: string;
    endTime?: string;
    daysOfWeek?: number[];
    timezone?: string;
    displayNote?: string;
  };
  description?: string;
  websiteUrl?: string;
  isPrimary: boolean;
}

export class ProactiveInterventionDto {
  userId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  triggers: TriggerFlag[];
  suggestedAction: SuggestedInterventionAction | string;

  // Resource bài tập can thiệp dạng động từ Admin (Flexible Dynamic Resource)
  resource?: InterventionResourceItemDto;

  // Gợi ý âm nhạc tĩnh / fallback nhẹ nhàng (nếu có)
  musicSuggestions?: MusicSuggestionItemDto[];

  // Hotline khẩn cấp (khi RiskLevel == CRISIS)
  hotlineInfo?: {
    number?: string;
    organization?: string;
    operatingHours?: string;
    primaryHotline?: EmergencyHotlineItemDto;
    secondaryHotlines?: EmergencyHotlineItemDto[];
  };

  chatbotPromptContext?: string;
  timestamp: Date | string;
}
