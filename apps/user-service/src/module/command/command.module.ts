import { DrizzleModule } from 'src/drizzle/drizzle.module';

import { ClerkModule } from '../clerk/clerk.module';
import { CommandService } from './command.service';
import { Module } from '@nestjs/common';

@Module({
  imports: [ClerkModule, DrizzleModule],
  providers: [CommandService],
  exports: [CommandService],
})
export class CommandModule {}
