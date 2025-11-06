import { IsEnum, IsOptional } from 'class-validator';
import { Emotion } from '../enums/social.enum';
import { CursorPaginationDTO } from '../../pagination';

export class GetPostQueryDTO extends CursorPaginationDTO {
  @IsOptional()
  @IsEnum(Emotion)
  feeling?: Emotion;
}
