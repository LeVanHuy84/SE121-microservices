import { Expose } from 'class-transformer';
import { GroupPrivacy } from '../enums';

export class AdminGroupDTO {
  @Expose()
  groupId: string;
  @Expose()
  name: string;
  @Expose()
  avatarUrl?: string;
  @Expose()
  privacy: GroupPrivacy;
  @Expose()
  members: number;
  @Expose()
  reports: number;
  @Expose()
  createdAt: Date;
}
