import { GroupPermission } from '@repo/dtos';
import { ROLE_PERMISSIONS } from 'src/common/constant/role-permission.constant';
import { GroupMember } from 'src/entities/group-member.entity';

export function canUserDo(
  member: GroupMember,
  action: GroupPermission,
): boolean {
  if (!member) return false;

  const customPerms = member.customPermissions as GroupPermission[] | undefined;
  if (customPerms?.includes(action)) return true;

  return ROLE_PERMISSIONS[member.role]?.includes(action) ?? false;
}
