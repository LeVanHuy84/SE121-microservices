import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OutboxEvent } from 'src/entities/outbox.entity';
import { OutboxProcessor } from './outbox.processor';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import { RecentActivityBatch } from './recent-activity.batch';
import { UserClientModule } from '../client/user/user-client.module';
import { KafkaProducerModule, NotificationModule } from '@repo/common';
import { ConfigService } from '@nestjs/config';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
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
    UserClientModule,
  ],
  providers: [
    OutboxProcessor,
    RecentActivityBufferService,
    RecentActivityBatch,
    OutboxService,
  ],
  exports: [
    OutboxProcessor,
    RecentActivityBufferService,
    RecentActivityBatch,
    OutboxService,
  ],
})
export class EventModule {}
