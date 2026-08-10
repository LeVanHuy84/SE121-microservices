import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdempotencyModule,
  IdempotencyService,
  KafkaProducerModule,
  NotificationModule,
  KafkaConsumerHelper,
  KafkaDLQService,
} from '@repo/common';
import { DrizzleIdempotencyRepository } from './services/drizzle-idempotency.repository';

// Controllers
import { GroupController } from './controllers/group.controller';
import { GroupSettingController } from './controllers/group-setting.controller';
import { GroupMemberController } from './controllers/group-member.controller';
import { GroupJoinRequestController } from './controllers/group-request.controller';
import { GroupInviteController } from './controllers/group-invite.controller';
import { GroupLogController } from './controllers/group-log.controller';
import { ReportController } from './controllers/group-report.controller';
import { GroupRecommendationController } from './controllers/group-recommendation.controller';
import { ConsumerController } from './controllers/group-consumer.controller';

// Services
import { GroupService } from './services/group.service';
import { GroupQueryService } from './services/group-query.service';
import { GroupHelperService } from './services/group-helper.service';
import { GroupCacheService } from './services/group-cache.service';
import { GroupSettingService } from './services/group-setting.service';
import { GroupMemberService } from './services/group-member.service';
import { GroupJoinRequestService } from './services/group-request.service';
import { GroupJoinRequestQueryService } from './services/group-request-query.service';
import { GroupInviteService } from './services/group-invite.service';
import { GroupLogService } from './services/group-log.service';
import { ReportService } from './services/group-report.service';
import { GroupRecommendationService } from './services/group-recommendation.service';
import { ConsumerService } from './services/group-consumer.service';
import { UserClientService } from './services/user-client.service';
import { SocialClientService } from './services/social-client.service';
import { GroupBatchService } from './services/group-batch.service';
import { GroupBufferService } from './services/group-buffer.service';

import { UserModule } from '../user/user.module';
import { FriendshipModule } from '../social/friendship/friendship.module';

// Drizzle
import { DrizzleModule } from 'src/drizzle/drizzle.module';

@Module({
  imports: [
    UserModule,
    FriendshipModule,
    DrizzleModule,
    {
      module: class CustomIdempotencyModule {},
      imports: [DrizzleModule],
      providers: [
        DrizzleIdempotencyRepository,
        {
          provide: 'IdempotencyRepository',
          useExisting: DrizzleIdempotencyRepository,
        },
        IdempotencyService,
      ],
      exports: [IdempotencyService],
    },
    KafkaProducerModule.registerAsync(),
    NotificationModule.registerAsync({
      useFactory: async (config: ConfigService) => ({
        urls: [
          `amqp://${config.get('RABBITMQ_USER')}:${config.get('RABBITMQ_PASS')}` +
            `@${config.get('RABBITMQ_HOST')}:${config.get('RABBITMQ_PORT')}`,
        ],
        queue: 'create_notification_queue',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    GroupController,
    GroupSettingController,
    GroupMemberController,
    GroupJoinRequestController,
    GroupInviteController,
    GroupLogController,
    ReportController,
    GroupRecommendationController,
    ConsumerController,
  ],
  providers: [
    GroupService,
    GroupQueryService,
    GroupHelperService,
    GroupCacheService,
    GroupSettingService,
    GroupMemberService,
    GroupJoinRequestService,
    GroupJoinRequestQueryService,
    GroupInviteService,
    GroupLogService,
    ReportService,
    GroupRecommendationService,
    ConsumerService,
    UserClientService,
    SocialClientService,
    GroupBatchService,
    GroupBufferService,
    KafkaConsumerHelper,
    KafkaDLQService,
  ],
  exports: [
    GroupService,
    GroupMemberService,
    GroupLogService,
  ],
})
export class GroupModule {}
