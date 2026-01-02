import { Global, Module } from '@nestjs/common';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import { RecentActivityBatch } from './recent-activity.batch';
import { NotificationModule } from './rabbitmq/notification.module';
import { UserClientModule } from 'src/client/user/user-client.module';
@Global()
@Module({
  imports: [NotificationModule, UserClientModule],
  providers: [RecentActivityBufferService, RecentActivityBatch],
  exports: [RecentActivityBufferService, RecentActivityBatch],
})
export class EventModule {}
