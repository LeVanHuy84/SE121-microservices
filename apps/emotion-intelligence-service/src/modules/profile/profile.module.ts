import { Module } from '@nestjs/common';
import { ProfileCron } from './profile.cron';
import { ProfileProcessor } from './profile.processor';
import { ProfileRepository } from './profile.repository';
import { ProfileService } from './profile.service';
import { AdminProfileController } from './admin-profile.controller';
import { AdminProfileService } from './admin-profile.service';

@Module({
  controllers: [AdminProfileController],
  providers: [
    ProfileRepository,
    ProfileService,
    ProfileProcessor,
    ProfileCron,
    AdminProfileService,
  ],
  exports: [ProfileRepository, ProfileService, ProfileProcessor],
})
export class ProfileModule {}
