import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ReactionType, TargetType } from '../enums/social.enum';
import { CursorPaginationDTO } from '../../pagination';

export class GetReactionsDTO extends CursorPaginationDTO {
  @IsUUID()
  targetId: string;

  @IsOptional()
  @IsEnum(TargetType)
  targetType: TargetType;

  @IsOptional()
  @IsEnum(ReactionType)
  reactionType?: ReactionType;
}
