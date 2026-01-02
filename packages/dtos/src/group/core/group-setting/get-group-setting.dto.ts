import { Expose } from 'class-transformer';

export class GroupSettingResponseDTO {
  @Expose()
  id: string;

  @Expose()
  groupId: string;

  @Expose()
  requiredPostApproval: boolean;

  @Expose()
  maxMembers: number;

  @Expose()
  allowMemberInvite: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  createdBy: string;

  @Expose()
  updatedBy: string;
}
