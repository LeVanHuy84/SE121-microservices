import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../pagination/pagination.dto';
import { Emotion } from '../../social/enums/social.enum';

export class TrendingQuery extends PaginationDTO {
  @IsOptional()
  @IsEnum(Emotion)
  mainEmotion?: Emotion;
}
