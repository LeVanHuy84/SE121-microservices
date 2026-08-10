import { Controller } from '@nestjs/common';
import { GroupSettingService } from './group-setting.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { GroupPermission, UpdateGroupSettingDTO } from '@repo/dtos';
import { RequireGroupPermission } from 'src/modules/group-authorization/require-group-permission.decorator';

@Controller('group-settings')
export class GroupSettingController {
  constructor(private readonly groupSettingService: GroupSettingService) {}

  @RequireGroupPermission(GroupPermission.VIEW_SETTINGS)
  @MessagePattern('get-group-setting')
  async getGroupSetting(
    @Payload() payload: { userId: string; groupId: string },
  ) {
    // Logic to get group setting by groupId
    return this.groupSettingService.getGroupSettingByGroupId(payload.groupId);
  }

  @RequireGroupPermission(GroupPermission.UPDATE_GROUP_SETTINGS)
  @MessagePattern('update-group-setting')
  async updateGroupSetting(
    @Payload()
    payload: {
      userId: string;
      groupId: string;
      settings: UpdateGroupSettingDTO;
    },
  ) {
    // Logic to update group setting by groupId
    return this.groupSettingService.updateGroupSetting(
      payload.userId,
      payload.groupId,
      payload.settings,
    );
  }
}
