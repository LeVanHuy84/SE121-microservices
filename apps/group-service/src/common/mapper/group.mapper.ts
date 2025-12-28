import {
  AdminGroupDTO,
  GroupResponseDTO,
  GroupSettingEmbbedDTO,
} from '@repo/dtos';
import { Group } from 'src/entities/group.entity';

export class GroupMapper {
  static toGroupResponseDTO(entity: Group): GroupResponseDTO {
    const dto = new GroupResponseDTO();
    dto.id = entity.id;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.avatarUrl = entity.avatar.url;
    dto.coverImageUrl = entity.coverImage.url;
    dto.privacy = entity.privacy;
    dto.rules = entity.rules;
    dto.members = entity.members;
    dto.status = entity.status;
    dto.createdAt = entity.createdAt;
    if (entity.groupSetting) {
      dto.groupSetting = new GroupSettingEmbbedDTO();
      dto.groupSetting.requiredPostApproval =
        entity.groupSetting.requiredPostApproval;
      dto.groupSetting.maxMembers = entity.groupSetting.maxMembers;
      dto.groupSetting.allowMemberInvite =
        entity.groupSetting.allowMemberInvite;
    }
    return dto;
  }

  toAdminGroupDTO(entity: Group): AdminGroupDTO {
    const dto = new AdminGroupDTO();
    dto.id = entity.id;
    dto.name = entity.name;
    dto.owner = entity.owner;
    dto.avatarUrl = entity.avatar.url;
    dto.privacy = entity.privacy;
    dto.members = entity.members;
    dto.reports = entity.reports;
    dto.status = entity.status;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}
