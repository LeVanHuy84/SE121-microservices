import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KafkaProducerModule } from '@repo/common';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import { RecentActivityBatch } from './recent-activity.batch';
import { NotificationModule } from './rabbitmq/notification.module';
import { UserClientModule } from 'src/client/user/user-client.module';
import { OutboxEventEntity } from 'src/postgres/entities/outbox-event.entity';
import { OutboxProcessor } from './outbox.processor';
import { OutboxService } from './outbox.service';
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEventEntity]),
    KafkaProducerModule.registerAsync(),
    NotificationModule,
    UserClientModule,
  ],
  providers: [
    OutboxProcessor,
    OutboxService,
    RecentActivityBufferService,
    RecentActivityBatch,
  ],
  exports: [
    OutboxProcessor,
    OutboxService,
    RecentActivityBufferService,
    RecentActivityBatch,
  ],
})
export class EventModule {}
