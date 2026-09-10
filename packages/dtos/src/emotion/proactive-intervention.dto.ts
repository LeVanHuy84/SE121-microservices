import { RiskLevel, TriggerFlag } from './enums';

export class BreathingExerciseDto {
  name: string;
  technique: string; // e.g. '4-7-8'
  inhaleSeconds: number;
  holdSeconds: number;
  exhaleSeconds: number;
  cycles: number;
  guideMessage: string;
}

export class MusicSuggestionItemDto {
  trackId?: string;
  title: string;
  artist?: string;
  genre?: string;
  moodTarget: string;
}

export class ProactiveInterventionDto {
  userId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  triggers: TriggerFlag[];
  suggestedAction:
    | 'NO_ACTION'
    | 'PLAYLIST_AND_TIPS'
    | 'BREATHING_AND_JOURNAL'
    | 'CHATBOT_COMPANION'
    | 'CRISIS_HOTLINE';

  breathingExercise?: BreathingExerciseDto;
  musicSuggestions?: MusicSuggestionItemDto[];
  journalingPrompt?: string;
  chatbotPromptContext?: string;
  hotlineInfo?: {
    number: string;
    organization: string;
    operatingHours: string;
  };

  resourceDocUrl?: string;

  timestamp: Date;
}
