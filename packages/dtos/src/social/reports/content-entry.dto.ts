import { MediaItemDTO } from '../../common';
import { TargetType } from '../enums';

export class ContentEntryDTO {
  id: string;
  type: TargetType;
  content: string;
  medias?: MediaItemDTO[];
  reportCount: number;
  createdAt: Date;
}
