import { Module } from '@nestjs/common';
import { GroupInviteController } from './group-invite.controller';
import { GroupInviteService } from './group-invite.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from 'src/entities/group-member.entity';
import { Group } from 'src/entities/group.entity';
import { BatchModule } from '../batch/batch.module';
import { GroupLogModule } from '../group-log/group-log.module';
import { GroupInvite } from 'src/entities/group-invite.entity';
import { UserClientModule } from '../client/user/user-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GroupInvite, GroupMember, Group]),
    GroupLogModule,
    BatchModule,
    UserClientModule,
  ],
  controllers: [GroupInviteController],
  providers: [GroupInviteService],
})
export class GroupInviteModule {}
