import { IsOptional } from 'class-validator';

export class UpdateGroupSettingDTO {
  @IsOptional()
  requiredPostApproval?: boolean;

  @IsOptional()
  allowInvites?: boolean;

  @IsOptional()
  maxMembers?: number;

  @IsOptional()
  requireAdminApprovalToJoin?: boolean;
}
