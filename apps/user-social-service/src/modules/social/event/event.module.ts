import { Global, Module } from '@nestjs/common';
import { KafkaProducerModule } from '@repo/common';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import { RecentActivityBatch } from './recent-activity.batch';
import { NotificationModule } from './rabbitmq/notification.module';
import { UserClientModule } from 'src/modules/social/services/user-client.module';
import { OutboxService } from 'src/modules/event/outbox.service';
import { DrizzleModule } from 'src/drizzle/drizzle.module';

@Global()
@Module({
  imports: [
    DrizzleModule,
    KafkaProducerModule.registerAsync(),
    NotificationModule,
    UserClientModule,
  ],
  providers: [
    OutboxService,
    RecentActivityBufferService,
    RecentActivityBatch,
  ],
  exports: [
    OutboxService,
    RecentActivityBufferService,
    RecentActivityBatch,
  ],
})
export class SocialEventModule {}
