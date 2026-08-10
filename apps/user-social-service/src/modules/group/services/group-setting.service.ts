import { Inject, Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  GroupEventLog,
  GroupSettingResponseDTO,
  UpdateGroupSettingDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { formatValue, SETTING_LABELS } from 'src/modules/group/common/constant/constant';
import { GroupLogService } from 'src/modules/group/services/group-log.service';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from 'src/drizzle/drizzle.module';
import type { DrizzleDB } from 'src/drizzle/types/drizzle.d';
import { groupSettings } from 'src/drizzle/schema/schema';

@Injectable()
export class GroupSettingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly groupLogService: GroupLogService,
  ) {}

  async getGroupSettingByGroupId(
    groupId: string,
  ): Promise<GroupSettingResponseDTO> {
    const [setting] = await this.db
      .select()
      .from(groupSettings)
      .where(eq(groupSettings.groupId, groupId))
      .limit(1);

    if (!setting) {
      throw new Error('Group setting not found');
    }

    return plainToInstance(GroupSettingResponseDTO, setting, {
      excludeExtraneousValues: true,
    });
  }

  async updateGroupSetting(
    userId: string,
    groupId: string,
    settings: UpdateGroupSettingDTO,
  ): Promise<GroupSettingResponseDTO> {
    return await this.db.transaction(async (tx) => {
      const [setting] = await tx
        .select()
        .from(groupSettings)
        .where(eq(groupSettings.groupId, groupId))
        .limit(1);

      if (!setting) {
        throw new RpcException({
          statusCode: 404,
          message: 'Group setting not found',
        });
      }

      const oldSetting = { ...setting };

      const [updatedSetting] = await tx
        .update(groupSettings)
        .set({ ...settings, updatedBy: userId, updatedAt: new Date() })
        .where(eq(groupSettings.groupId, groupId))
        .returning();

      // Log changes
      const changes = Object.entries(settings)
        .filter(([key, val]) => oldSetting[key] !== val)
        .map(([key, val]) => ({
          field: SETTING_LABELS[key] ?? key,
          from: formatValue(oldSetting[key]),
          to: formatValue(val),
        }));

      if (changes.length) {
        await this.groupLogService.log(tx, {
          groupId,
          userId,
          eventType: GroupEventLog.GROUP_SETTING_CHANGED,
          content: `Cập nhật cài đặt nhóm:\n${changes
            .map((c) => `- ${c.field}: ${c.from} → ${c.to}`)
            .join('\n')}`,
        });
      }

      return plainToInstance(GroupSettingResponseDTO, updatedSetting, {
        excludeExtraneousValues: true,
      });
    });
  }
}
