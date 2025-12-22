import { Module } from '@nestjs/common';
import { DrizzleModule } from './drizzle/drizzle.module';
import { UserModule } from './module/user.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { EventModule } from './module/event/event.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './module/admin/admin.module';
import { CommandModule } from './module/command/command.module';
import { ClerkModule } from './module/clerk/clerk.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule,
    RedisModule,
    UserModule,
    ScheduleModule.forRoot(),
    RedisModule.forRoot({
      type: 'single',
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
  ],
})
export class AppModule {}
