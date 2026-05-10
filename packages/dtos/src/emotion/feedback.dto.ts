import { Emotion, TargetType } from '../social';
import { IsString, IsBoolean, IsEnum, IsOptional } from 'class-validator';

/* =======================
   CREATE FEEDBACK DTO
======================= */

export class CreateFeedbackDto {
  @IsString()
  targetId: string;

  @IsEnum(TargetType)
  targetType: TargetType;

  @IsBoolean()
  isAccurate: boolean;

  @IsOptional()
  @IsEnum(Emotion)
  expectedEmotion?: Emotion;
}

/* =======================
   FEEDBACK RESPONSE DTO
======================= */

export class FeedbackResponseDto {
  id: string;

  targetId: string;

  targetType: TargetType;

  isAccurate: boolean;

  expectedEmotion?: Emotion;

  predictedEmotion: Emotion;

  confidence: number;

  modelVersion: string;

  createdAt: Date;
}
