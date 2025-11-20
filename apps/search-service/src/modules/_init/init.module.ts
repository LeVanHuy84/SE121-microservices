import { Module } from '@nestjs/common';
import { PostInitService } from './post-init.service';
import { GroupInitService } from './group-init.service';

@Module({
  imports: [],
  providers: [PostInitService, GroupInitService],
})
export class InitModule {}
