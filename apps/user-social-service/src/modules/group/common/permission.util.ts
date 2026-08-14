import { GroupPermission, GroupRole } from "@repo/dtos";
import { ROLE_PERMISSIONS } from "src/modules/group/common/constant/role-permission.constant";
import type { GroupMember } from "src/drizzle/schema/group.schema";

export function canUserDo(
  member: GroupMember,
  action: GroupPermission,
): boolean {
  if (!member) return false;

  const customPerms = member.customPermissions as GroupPermission[] | undefined;
  if (customPerms?.includes(action)) return true;

  return ROLE_PERMISSIONS[member.role as GroupRole]?.includes(action) ?? false;
}
