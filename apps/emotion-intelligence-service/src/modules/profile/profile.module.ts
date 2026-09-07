import { Module } from '@nestjs/common';
import { ProfileCron } from './profile.cron';
import { ProfileProcessor } from './profile.processor';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { UserClientModule } from '../client/user/user-client.module';

import { TimeDecayCalculator } from '../analytics/time-decay.calculator';

@Module({
  imports: [UserClientModule],
  providers: [
    ProfileRepository,
    ProfileService,
    ProfileProcessor,
    ProfileCron,
    TimeDecayCalculator,
  ],
  exports: [ProfileRepository, ProfileService, ProfileProcessor],
})
export class ProfileModule {}
