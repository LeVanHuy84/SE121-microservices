import { Expose } from 'class-transformer';
import { GroupPrivacy } from '../../enums';

export class GroupSummaryResponse {
  @Expose()
  id: string;
  @Expose()
  name: string;
  @Expose()
  description?: string;
  @Expose()
  avatarUrl?: string;
  @Expose()
  privacy: GroupPrivacy;
  @Expose()
  members: number;
  @Expose()
  createdAt: Date;
}
