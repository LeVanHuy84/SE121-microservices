import { Module } from '@nestjs/common';
import { GroupInviteController } from './group-invite.controller';
import { GroupInviteService } from './group-invite.service';

@Module({
  controllers: [GroupInviteController],
  providers: [GroupInviteService]
})
export class GroupInviteModule {}
