import { IsOptional } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { Emotion } from '../../social';

export class PersonalFeedQuery extends CursorPaginationDTO {
  @IsOptional()
  mainEmotion?: Emotion;
}
