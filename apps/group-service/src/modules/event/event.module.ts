import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from 'src/entities/outbox.entity';
import { OutboxProcessor } from './outbox.processor';
import { KafkaProducerModule, NotificationModule } from '@repo/common';
import { ConfigService } from '@nestjs/config';
import { Group } from 'src/entities/group.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([OutboxEvent, Group]),
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
  providers: [OutboxProcessor],
  exports: [OutboxProcessor],
})
export class EventModule {}
