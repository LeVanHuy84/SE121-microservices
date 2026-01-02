import { Module } from '@nestjs/common';
import { GroupCoreModule } from './modules/group-core/group-core.module';
import { GroupMemberModule } from './modules/member/group-member.module';
import { GroupAuthorizationModule } from './modules/group-authorization/group-authorization.module';
import { GroupRequestModule } from './modules/group-request/group-request.module';
import { ReportModule } from './modules/report/report.module';
import { EventModule } from './modules/event/event.module';
import { RedisModule } from '@nestjs-modules/ioredis';
import { PostgresModule } from './postgres/postgres.module';
import { ScheduleModule } from '@nestjs/schedule';
import { GroupLogModule } from './modules/group-log/group-log.module';
import { GroupInviteModule } from './modules/group-invite/group-invite.module';

@Module({
  imports: [
    PostgresModule,
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.POST_REDIS_HOST,
        port: process.env.POST_REDIS_PORT
          ? parseInt(process.env.POST_REDIS_PORT, 10)
          : 6379,
      },
    }),
    ScheduleModule.forRoot(),
    GroupAuthorizationModule,
    GroupCoreModule,
    GroupMemberModule,
    GroupRequestModule,
    ReportModule,
    GroupLogModule,
    EventModule,
    GroupInviteModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
