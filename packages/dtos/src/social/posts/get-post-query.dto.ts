import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDTO } from '../../pagination/pagination.dto';
import { Emotion } from '../enums/social.enum';

export class GetPostQueryDTO extends PaginationDTO {
  @IsOptional()
  @IsEnum(Emotion)
  feeling?: Emotion;
}
