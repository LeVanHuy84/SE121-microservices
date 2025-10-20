import { IsEnum, IsOptional } from 'class-validator';
import { Emotion } from '../../social/enums/social.enum';
import { CursorPaginationDTO } from '../../pagination';

export class TrendingQuery extends CursorPaginationDTO {
  @IsOptional()
  @IsEnum(Emotion)
  mainEmotion?: Emotion;
}
