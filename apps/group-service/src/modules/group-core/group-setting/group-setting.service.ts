import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { GroupSettingResponseDTO, UpdateGroupSettingDTO } from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { GroupSetting } from 'src/entities/group-setting.entity';
import { Repository } from 'typeorm';

@Injectable()
export class GroupSettingService {
  constructor(
    @InjectRepository(GroupSetting)
    private groupSettingRepository: Repository<GroupSetting>,
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
    const setting = await this.groupSettingRepository.findOne({
      where: { groupId },
    });
    if (!setting) {
      throw new Error('Group setting not found');
    }
    const updatedSetting = Object.assign(setting, settings);
    updatedSetting.updatedBy = userId;
    await this.groupSettingRepository.save(updatedSetting);
    return plainToInstance(GroupSettingResponseDTO, updatedSetting, {
      excludeExtraneousValues: true,
    });
  }
}
