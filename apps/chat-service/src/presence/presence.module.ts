import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { RedisModule } from '@repo/common';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    RedisModule.forRoot({
      name: 'presence',
      config: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: +(process.env.REDIS_PORT ?? 6379),
        db: 0,
      },
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [PresenceService],
})
export class PresenceModule {}
