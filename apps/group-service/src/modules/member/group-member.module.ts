import { Module } from '@nestjs/common';
import { GroupMemberController } from './group-member.controller';
import { GroupMemberService } from './group-member.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { GroupLogModule } from '../group-log/group-log.module';
import { UserClientModule } from '../client/user/user-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GroupMember]),
    GroupLogModule,
    UserClientModule,
  ],
  controllers: [GroupMemberController],
  providers: [GroupMemberService],
  exports: [GroupMemberService],
})
export class GroupMemberModule {}
