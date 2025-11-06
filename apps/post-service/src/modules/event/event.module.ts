import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KafkaModule } from './kafka/kafka.module';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { NotificationModule } from './rabbitmq/notification.module';
import { OutboxProcessor } from './outbox.processor';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import { RecentActivityBatch } from './recent-activity.batch';
import { UserClientModule } from '../client/user/user-client.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
    KafkaModule,
    NotificationModule,
    UserClientModule,
  ],
  providers: [
    OutboxProcessor,
    RecentActivityBufferService,
    RecentActivityBatch,
  ],
  exports: [OutboxProcessor, RecentActivityBufferService, RecentActivityBatch],
})
export class EventModule {}
