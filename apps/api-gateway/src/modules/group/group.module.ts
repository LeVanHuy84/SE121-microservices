import { Module } from '@nestjs/common';
import { GroupController } from './group.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GroupMemberController } from './group-member.controller';
import { GroupJoinRequestController } from './group-join-request.controller';
import { GroupReportController } from './group-report.controller';
import { GroupLogController } from './group-log.controller';
import { GroupInviteController } from './group-invite.controller';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.GROUP_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('GROUP_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [
    GroupController,
    GroupMemberController,
    GroupJoinRequestController,
    GroupInviteController,
    GroupReportController,
    GroupLogController,
  ],
})
export class GroupModule {}
