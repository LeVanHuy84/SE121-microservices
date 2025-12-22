import { MediaItemDTO } from '../../common';
import { TargetType } from '../enums';

export class ContentEntryDTO {
  id: string;
  type: TargetType;
  content: string;
  medias?: MediaItemDTO[];
  reportPendingCount: number;
  createdAt: Date;
}
