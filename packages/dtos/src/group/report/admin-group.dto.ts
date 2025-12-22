import { Expose, Type } from 'class-transformer';
import { GroupPrivacy, GroupStatus } from '../enums';
import { IsEnum } from 'class-validator';
import { GroupOwnerSnapshot } from '../core';

export class AdminGroupDTO {
  @Expose()
  id: string;
  @Expose()
  name: string;
  @Expose()
  @Type(() => GroupOwnerSnapshot)
  owner: GroupOwnerSnapshot;
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
