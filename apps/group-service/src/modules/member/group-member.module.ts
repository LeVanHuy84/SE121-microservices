import { Module } from '@nestjs/common';
import { GroupMemberController } from './group-member.controller';
import { GroupMemberService } from './group-member.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupLogModule } from '../group-log/group-log.module';

@Module({
  imports: [TypeOrmModule.forFeature([GroupMember]), GroupLogModule],
  controllers: [GroupMemberController],
  providers: [GroupMemberService],
  exports: [GroupMemberService],
})
export class GroupMemberModule {}
