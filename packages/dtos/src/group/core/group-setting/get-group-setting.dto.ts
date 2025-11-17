import { Expose } from 'class-transformer';

export class GroupSettingResponseDTO {
  @Expose()
  id: string;

  @Expose()
  groupId: string;

  @Expose()
  requiredPostApproval: boolean;

  @Expose()
  allowInvites: boolean;

  @Expose()
  maxMembers: number;

  @Expose()
  requireAdminApprovalToJoin: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  createdBy: string;

  @Expose()
  updatedBy: string;
}
