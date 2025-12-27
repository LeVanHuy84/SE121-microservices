import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import {
  GroupEventLog,
  GroupSettingResponseDTO,
  UpdateGroupSettingDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupSetting } from 'src/entities/group-setting.entity';
import { GroupLogService } from 'src/modules/group-log/group-log.service';
import { DataSource, Repository } from 'typeorm';

@Injectable()
export class GroupSettingService {
  constructor(
    @InjectRepository(GroupSetting)
    private groupSettingRepository: Repository<GroupSetting>,
    private readonly dataSource: DataSource,
    private readonly groupLogService: GroupLogService,
  ) {}

  async getGroupSettingByGroupId(
    groupId: string,
  ): Promise<GroupSettingResponseDTO> {
    const groupSetting = await this.groupSettingRepository.findOne({
      where: { groupId },
    });
    if (!groupSetting) {
      throw new Error('Group setting not found');
    }
    return plainToInstance(GroupSettingResponseDTO, groupSetting, {
      excludeExtraneousValues: true,
    });
  }

  async updateGroupSetting(
    userId: string,
    groupId: string,
    settings: UpdateGroupSettingDTO,
  ): Promise<GroupSettingResponseDTO> {
    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(GroupSetting);

      const setting = await repo.findOne({ where: { groupId } });
      if (!setting) {
        throw new RpcException({
          statusCode: 404,
          message: 'Group setting not found',
        });
      }

      // Update settings
      Object.assign(setting, settings);
      setting.updatedBy = userId;

      const updatedSetting = await repo.save(setting);

      // Log event
      await this.groupLogService.log(manager, {
        groupId,
        userId,
        eventType: GroupEventLog.GROUP_SETTING_CHANGED,
        content: `Group settings updated: ${Object.entries(settings)
          .map(([key, val]) => `${key}=${val}`)
          .join(', ')}`,
      });

      return plainToInstance(GroupSettingResponseDTO, updatedSetting, {
        excludeExtraneousValues: true,
      });
    });
  }
}
