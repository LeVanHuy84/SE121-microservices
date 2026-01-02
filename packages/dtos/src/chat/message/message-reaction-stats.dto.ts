import { Expose } from 'class-transformer';

export class ReactionStatsDTO {
  @Expose()
  JOY: number;

  @Expose()
  SADNESS: number;

  @Expose()
  ANGER: number;

  @Expose()
  FEAR: number;

  @Expose()
  DISGUST: number;

  @Expose()
  SURPRISE: number;

  @Expose()
  NEUTRAL: number;
}
