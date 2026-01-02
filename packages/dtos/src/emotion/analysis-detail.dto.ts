import { Emotion, TargetType } from '../social';

/* =======================
   ENUMS
======================= */

export enum AnalysisStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

/* =======================
   COMMON SCORES DTO
======================= */

export class EmotionScoresDto {
  anger: number;
  disgust: number;
  joy: number;
  fear: number;
  neutral: number;
  sadness: number;
  surprise: number;
}

/* =======================
   TEXT EMOTION
======================= */

export class TextEmotionDto {
  dominantEmotion: Emotion;
  emotionScores: EmotionScoresDto;
}

/* =======================
   IMAGE EMOTION
======================= */

export class ImageEmotionDto {
  url: string;
  faceCount: number;
  dominantEmotion: Emotion;
  emotionScores: EmotionScoresDto;
  error: string | null;
}

/* =======================
   MAIN DTO
======================= */

export class EmotionAnalysisDto {
  userId: string;
  targetId: string;
  targetType: TargetType;
  textEmotion: TextEmotionDto | null;
  imageEmotions: ImageEmotionDto[];
  finalEmotion: Emotion;
  finalScores: EmotionScoresDto;
  status: AnalysisStatus;
  errorReason: string | null;
  createdAt: Date;
}
