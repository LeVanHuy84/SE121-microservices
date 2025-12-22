import { Expose } from 'class-transformer';
import { GroupPrivacy, GroupStatus } from '../enums';
import { IsEnum } from 'class-validator';

export class AdminGroupDTO {
  @Expose()
  id: string;
  @Expose()
  name: string;
  @Expose()
  avatarUrl?: string;
  @Expose()
  @IsEnum(GroupPrivacy)
  privacy: GroupPrivacy;
  @Expose()
  members: number;
  @Expose()
  reports: number;
  @Expose()
  @IsEnum(GroupStatus)
  status: GroupStatus;
  @Expose()
  createdAt: Date;
}
