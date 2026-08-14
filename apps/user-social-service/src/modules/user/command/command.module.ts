import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DrizzleModule } from "src/drizzle/drizzle.module";

import { ClerkModule } from "../clerk/clerk.module";
import { CommandService } from "./command.service";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ClerkModule,
    DrizzleModule,
  ],
  providers: [CommandService],
  exports: [CommandService],
})
export class CommandModule {}
