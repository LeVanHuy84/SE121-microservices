import { Module } from "@nestjs/common";
import { DrizzleModule } from "./drizzle/drizzle.module";
import { UserModule } from "./modules/user/user.module";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RedisModule } from "@nestjs-modules/ioredis";
import { EventModule } from "./modules/event/event.module";
import { ScheduleModule } from "@nestjs/schedule";
import { AdminModule } from "./modules/user/admin/admin.module";
import { CommandModule } from "./modules/user/command/command.module";
import { ClerkModule } from "./modules/user/clerk/clerk.module";

// Social modules
import { FriendshipModule } from "./modules/social/friendship/friendship.module";
import { SocialEventModule } from "./modules/social/event/event.module";

// Group modules
import { GroupModule } from "./modules/group/group.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule,
    UserModule,
    ScheduleModule.forRoot(),
    RedisModule.forRoot({
      type: "single",
      options: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
          ? parseInt(process.env.REDIS_PORT, 10)
          : 6379,
      },
    }),
    EventModule,
    AdminModule,
    ClerkModule,
    CommandModule,

    // Social Modules
    FriendshipModule,
    SocialEventModule,

    // Group Module
    GroupModule,
  ],
})
export class AppModule {}
