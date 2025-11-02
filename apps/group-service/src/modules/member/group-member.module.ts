import { Module } from '@nestjs/common';
import { GroupMemberController } from './group-member.controller';
import { GroupMemberService } from './group-member.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';

@Module({
  imports: [TypeOrmModule.forFeature([GroupMember])],
  controllers: [GroupMemberController],
  providers: [GroupMemberService],
  exports: [GroupMemberService],
})
export class GroupMemberModule {}
