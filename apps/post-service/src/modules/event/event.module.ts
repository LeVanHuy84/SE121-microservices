import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KafkaModule } from './kafka/kafka.module';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { OutboxProcessor } from './outbox.processor';
import { RecentActivityBufferService } from './recent-activity.buffer.service';
import { RecentActivityBatch } from './recent-activity.batch';
import { UserClientModule } from '../client/user/user-client.module';
import { NotificationModule } from '@repo/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent]),
    KafkaModule,
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
  ],
  exports: [OutboxProcessor, RecentActivityBufferService, RecentActivityBatch],
})
export class EventModule {}
