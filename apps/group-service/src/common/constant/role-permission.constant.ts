import { GroupPermission, GroupRole } from '@repo/dtos';

export const ROLE_PERMISSIONS: Record<GroupRole, GroupPermission[]> = {
  [GroupRole.ADMIN]: [
    GroupPermission.MANAGE_GROUP,
    GroupPermission.MANAGE_MEMBERS,
    GroupPermission.APPROVE_POST,
    GroupPermission.DELETE_POST,
    GroupPermission.PIN_POST,
    GroupPermission.BAN_MEMBER,
    GroupPermission.VIEW_REPORTS,
    GroupPermission.UPDATE_GROUP,
    GroupPermission.UPDATE_GROUP_SETTINGS,
    GroupPermission.MANAGE_EVENTS,
    GroupPermission.DELETE_GROUP,
  ],
  [GroupRole.MODERATOR]: [
    GroupPermission.MANAGE_MEMBERS,
    GroupPermission.APPROVE_POST,
    GroupPermission.DELETE_POST,
    GroupPermission.PIN_POST,
    GroupPermission.BAN_MEMBER,
    GroupPermission.VIEW_REPORTS,
    GroupPermission.MANAGE_EVENTS,
  ],
  [GroupRole.MEMBER]: [],
};
