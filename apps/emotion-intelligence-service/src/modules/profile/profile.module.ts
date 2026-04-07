import { Module } from '@nestjs/common';
import { ProfileCron } from './profile.cron';
import { ProfileProcessor } from './profile.processor';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';

@Module({
  providers: [ProfileRepository, ProfileService, ProfileProcessor, ProfileCron],
  exports: [ProfileRepository, ProfileService, ProfileProcessor],
})
export class ProfileModule {}
