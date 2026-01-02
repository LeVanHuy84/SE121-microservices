export enum GroupNotificationType {
  REQUEST_TO_JOIN_GROUP = 'request_to_join_group',

  USER_LEFT_GROUP = 'user_left_group',
  USER_REMOVED_FROM_GROUP = 'user_removed_from_group',
  USER_BANNED_FROM_GROUP = 'user_banned_from_group',
  USER_UNBANNED_IN_GROUP = 'user_unbanned_in_group',

  GROUP_ROLE_CHANGED = 'group_role_changed',
  GROUP_PERMISSION_CHANGED = 'group_permission_changed',
}
