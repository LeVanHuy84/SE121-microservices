import { Expose } from 'class-transformer';
import { GroupMemberStatus, GroupPermission, GroupRole } from '../..';

export class GroupMemberDTO {
  @Expose()
  id: string;

  @Expose()
  userId: string;

  userName: string;
  avatarUrl: string;

  @Expose()
  groupId: string;

  @Expose()
  status: GroupMemberStatus;

  @Expose()
  role: GroupRole;

  @Expose()
  customPermissions: GroupPermission[];
}
