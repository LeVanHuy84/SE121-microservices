import {
  AdminGroupDTO,
  GroupResponseDTO,
  GroupSettingEmbbedDTO,
} from "@repo/dtos";
import type { Group } from "src/drizzle/schema/group.schema";

export class GroupMapper {
  static toGroupResponseDTO(
    entity: Group & { groupSetting?: any },
  ): GroupResponseDTO {
    const dto = new GroupResponseDTO();
    dto.id = entity.id;
    dto.name = entity.name;
    dto.description = entity.description ?? undefined;
    dto.avatarUrl = entity.avatar?.url || "";
    dto.coverImageUrl = entity.coverImage?.url || "";
    dto.privacy = entity.privacy as any;
    dto.rules = entity.rules ?? undefined;
    dto.members = entity.members;
    dto.status = entity.status as any;
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

  static toAdminGroupDTO(entity: Group): AdminGroupDTO {
    const dto = new AdminGroupDTO();
    dto.id = entity.id;
    dto.name = entity.name;
    dto.owner = entity.owner as any;
    dto.avatarUrl = entity.avatar?.url || "";
    dto.privacy = entity.privacy as any;
    dto.members = entity.members;
    dto.reports = entity.reports;
    dto.status = entity.status as any;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}
