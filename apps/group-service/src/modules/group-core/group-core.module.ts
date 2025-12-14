import { Module } from '@nestjs/common';
import { GroupController } from './group/group.controller';
import { GroupService } from './group/group.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from 'src/entities/group.entity';
import { GroupSetting } from 'src/entities/group-setting.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupSettingController } from './group-setting/group-setting.controller';
import { GroupSettingService } from './group-setting/group-setting.service';
import { GroupCacheService } from './group/group-cache.service';
import { GroupLog } from 'src/entities/group-log.entity';
import { GroupLogModule } from '../group-log/group-log.module';
import { SocialClientModule } from '../client/social/social-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Group, GroupSetting, GroupMember, GroupLog]),
    GroupLogModule,
    SocialClientModule,
  ],
  controllers: [GroupController, GroupSettingController],
  providers: [GroupService, GroupSettingService, GroupCacheService],
  exports: [GroupService],
})
export class GroupCoreModule {}
