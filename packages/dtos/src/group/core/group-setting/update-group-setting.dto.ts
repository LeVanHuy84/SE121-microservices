import { IsOptional } from 'class-validator';

export class UpdateGroupSettingDTO {
  @IsOptional()
  requiredPostApproval?: boolean;

  @IsOptional()
  maxMembers?: number;

  @IsOptional()
  requireAdminApprovalToJoin?: boolean;

  @IsOptional()
  allowMemberInvite?: boolean;
}
