import { GroupPermission, GroupPrivacy, GroupRole } from '../../enums';

export class PostPermissionDTO {
  isMember: boolean;
  privacy: GroupPrivacy;
  requireApproval: boolean;
  role: GroupRole | null;
  permissions: GroupPermission[];
}
