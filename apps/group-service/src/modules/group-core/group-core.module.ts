import { Module } from '@nestjs/common';
import { GroupController } from './group/group.controller';
import { GroupService } from './group/service/group.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from 'src/entities/group.entity';
import { GroupSetting } from 'src/entities/group-setting.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupSettingController } from './group-setting/group-setting.controller';
import { GroupSettingService } from './group-setting/group-setting.service';
import { GroupCacheService } from './group/service/group-cache.service';
import { GroupLog } from 'src/entities/group-log.entity';
import { GroupLogModule } from '../group-log/group-log.module';
import { SocialClientModule } from '../client/social/social-client.module';
import { UserClientModule } from '../client/user/user-client.module';
import { GroupQueryService } from './group/service/group-query.service';
import { GroupHelperService } from './group/service/group-helper.service';
import { GroupInvite } from 'src/entities/group-invite.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Group,
      GroupSetting,
      GroupMember,
      GroupLog,
      GroupInvite,
    ]),
    GroupLogModule,
    SocialClientModule,
    UserClientModule,
  ],
  controllers: [GroupController, GroupSettingController],
  providers: [
    GroupService,
    GroupSettingService,
    GroupCacheService,
    GroupQueryService,
    GroupHelperService,
  ],
  exports: [GroupService],
})
export class GroupCoreModule {}
