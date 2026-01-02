import { IsOptional } from 'class-validator';
import { CursorPaginationDTO } from '../../pagination';
import { GroupMemberStatus, GroupRole } from '../enums';

export class GroupMemberFilter extends CursorPaginationDTO {
  //   @IsOptional()
  //   userName?: string;

  @IsOptional()
  role?: GroupRole;

  @IsOptional()
  status?: GroupMemberStatus;
}
