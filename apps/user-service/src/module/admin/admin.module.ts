import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { EventModule } from '../event/event.module';
import { ClerkModule } from '../clerk/clerk.module';

@Module({
  imports: [DrizzleModule, EventModule, ClerkModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
