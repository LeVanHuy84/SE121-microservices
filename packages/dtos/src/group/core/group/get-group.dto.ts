import { Expose, Type } from 'class-transformer';
import {
  GroupPrivacy,
  GroupRole,
  GroupStatus,
  MembershipStatus,
} from '../../enums';

export class GroupSettingEmbbedDTO {
  @Expose()
  requiredPostApproval: boolean;

  @Expose()
  maxMembers: number;

  @Expose()
  allowMemberInvite: boolean;
}

export class GroupResponseDTO {
  @Expose()
  id: string;
  @Expose()
  name: string;
  @Expose()
  description?: string;
  @Expose()
  avatarUrl: string;
  @Expose()
  coverImageUrl: string;
  @Expose()
  privacy: GroupPrivacy;
  @Expose()
  rules?: string;
  @Expose()
  members: number;
  @Expose()
  status: GroupStatus;
  @Expose()
  createdAt: Date;
  @Expose()
  @Type(() => GroupSettingEmbbedDTO)
  groupSetting?: GroupSettingEmbbedDTO;

  userRole?: GroupRole;
  membershipStatus?: MembershipStatus;
}
