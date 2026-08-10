import { Global, Module } from '@nestjs/common';
import { KafkaProducerModule, NotificationModule } from '@repo/common';
import { ConfigService } from '@nestjs/config';
import { OutboxProcessor } from './outbox.processor';
import { DrizzleModule } from 'src/drizzle/drizzle.module';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  imports: [
    DrizzleModule,

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
  providers: [OutboxProcessor, OutboxService],
  exports: [OutboxProcessor, OutboxService],
})
export class EventModule {}
