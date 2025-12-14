import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupLog } from 'src/entities/group-log.entity';
import { GroupLogController } from './group-log.controller';
import { GroupLogService } from './group-log.service';
import { GroupMember } from 'src/entities/group-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GroupLog, GroupMember])],
  controllers: [GroupLogController],
  providers: [GroupLogService],
  exports: [GroupLogService],
})
export class GroupLogModule {}
