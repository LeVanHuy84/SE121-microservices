import { MediaItemDTO } from '../../common';
import { ContentStatus, TargetType } from '../enums';

export class ContentEntryDTO {
  id: string;
  type: TargetType;
  content: string;
  medias?: MediaItemDTO[];
  reportPendingCount: number;
  status: ContentStatus;
  createdAt: Date;
}
