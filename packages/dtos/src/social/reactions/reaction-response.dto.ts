import { Expose } from 'class-transformer';
import { ReactionType } from '../enums/social.enum';
import { IsEnum } from 'class-validator';

export class ReactionResponseDTO {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  @Expose()
  @IsEnum(ReactionType)
  reactionType: ReactionType;
}
