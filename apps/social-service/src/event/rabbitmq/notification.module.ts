// src/common/modules/social-client.module.ts
import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'NOTIFICATION_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              `amqp://${configService.get('RABBITMQ_USER')}:${configService.get(
                'RABBITMQ_PASS',
              )}@${configService.get('RABBITMQ_HOST')}:${configService.get(
                'RABBITMQ_PORT',
              )}`,
            ],
            queue: 'create_notification_queue',
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
