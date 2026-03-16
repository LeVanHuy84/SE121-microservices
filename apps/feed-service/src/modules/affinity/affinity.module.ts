import { Module } from '@nestjs/common';
import { UserAffinityService } from './user-affinity.service';

@Module({
  providers: [UserAffinityService],
  exports: [UserAffinityService],
})
export class AffinityModule {}
