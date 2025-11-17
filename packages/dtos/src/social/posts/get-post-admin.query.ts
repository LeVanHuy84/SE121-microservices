import { IsEnum, IsOptional } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { Emotion, PostGroupStatus } from '../enums';

export class GetGroupPostQueryDTO extends CursorPaginationDTO {
  @IsOptional()
  @IsEnum(Emotion)
  mainEmotion?: Emotion;

  @IsOptional()
  @IsEnum(PostGroupStatus)
  status?: PostGroupStatus;
}
