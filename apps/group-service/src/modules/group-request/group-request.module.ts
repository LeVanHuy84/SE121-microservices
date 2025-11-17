import { Module } from '@nestjs/common';
import { GroupJoinRequestService } from './group-request.service';
import { GroupJoinRequestController } from './group-request.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupJoinRequest } from 'src/entities/group-join-request.entity';
import { GroupMember } from 'src/entities/group-member.entity';
import { Group } from 'src/entities/group.entity';
import { GroupJoinRequestQueryService } from './group-request-query.service';
import { GroupLogModule } from '../group-log/group-log.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GroupJoinRequest, GroupMember, Group]),
    GroupLogModule,
  ],
  controllers: [GroupJoinRequestController],
  providers: [GroupJoinRequestService, GroupJoinRequestQueryService],
})
export class GroupRequestModule {}
