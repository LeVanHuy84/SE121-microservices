import { CursorPaginationDTO } from '../../pagination';
import { Emotion } from '../../social';

export class PersonalFeedQuery extends CursorPaginationDTO {
  mainEmotion?: Emotion;
}
