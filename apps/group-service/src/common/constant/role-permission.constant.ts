import { GroupPermission, GroupRole } from '@repo/dtos';

export const ROLE_PERMISSIONS: Record<GroupRole, GroupPermission[]> = {
  [GroupRole.OWNER]: [],
  [GroupRole.ADMIN]: [
    GroupPermission.MANAGE_GROUP,
    GroupPermission.MANAGE_MEMBERS,
    GroupPermission.APPROVE_POST,
    GroupPermission.DELETE_POST,
    GroupPermission.BAN_MEMBER,
    GroupPermission.VIEW_REPORTS,
    GroupPermission.UPDATE_GROUP,
    GroupPermission.VIEW_SETTINGS,
    GroupPermission.UPDATE_GROUP_SETTINGS,
    GroupPermission.MANAGE_JOIN_REQUESTS,
    GroupPermission.MANAGE_EVENTS,
  ],
  [GroupRole.MODERATOR]: [
    GroupPermission.MANAGE_MEMBERS,
    GroupPermission.MANAGE_JOIN_REQUESTS,
    GroupPermission.APPROVE_POST,
    GroupPermission.DELETE_POST,
    GroupPermission.BAN_MEMBER,
    GroupPermission.VIEW_SETTINGS,
    GroupPermission.VIEW_REPORTS,
    GroupPermission.MANAGE_EVENTS,
  ],
  [GroupRole.MEMBER]: [],
};
