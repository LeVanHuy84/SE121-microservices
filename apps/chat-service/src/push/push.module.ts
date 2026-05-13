import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationModule } from '@repo/common';
import { UserClientModule } from 'src/client/user/user-client.module';
import { PresenceModule } from 'src/presence/presence.module';
import { ChatPushService } from './chat-push.service';

@Module({
  imports: [
    NotificationModule.registerAsync({
      useFactory: async (config: ConfigService) => ({
        urls: [
          `amqp://${config.get('RABBITMQ_USER')}:${config.get('RABBITMQ_PASS')}` +
            `@${config.get('RABBITMQ_HOST')}:${config.get('RABBITMQ_PORT')}`,
        ],
        queue: config.get('RABBITMQ_QUEUE') || 'create_notification_queue',
      }),
      inject: [ConfigService],
    }),
    PresenceModule,
    UserClientModule,
  ],
  providers: [ChatPushService],
  exports: [ChatPushService],
})
export class PushModule {}
