import { Module } from '@nestjs/common';
import { PostInitService } from './post-init.service';
import { GroupInitService } from './group-init.service';
import { UserInitService } from './user-init.service';

@Module({
  imports: [],
  providers: [PostInitService, GroupInitService, UserInitService],
})
export class InitModule {}
