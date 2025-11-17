import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KafkaModule } from './kafka/kafka.module';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { OutboxProcessor } from './outbox.processor';
import { NotificationModule } from '@repo/common';
import { ConfigService } from '@nestjs/config';
import { GroupCoreModule } from '../group-core/group-core.module';

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
    GroupCoreModule,
  ],
  providers: [OutboxProcessor],
  exports: [OutboxProcessor],
})
export class EventModule {}
