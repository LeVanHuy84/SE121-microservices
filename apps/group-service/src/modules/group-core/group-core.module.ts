import { Module } from '@nestjs/common';
import { GroupController } from './group/group.controller';
import { GroupService } from './group/group.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from 'src/entities/group.entity';
import { GroupSetting } from 'src/entities/group-setting.entity';
import { GroupCategory } from 'src/entities/group-category.entity';
import { GroupMember } from 'src/entities/group-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Group, GroupSetting, GroupCategory, GroupMember]),
  ],
  controllers: [GroupController],
  providers: [GroupService],
})
export class GroupCoreModule {}
