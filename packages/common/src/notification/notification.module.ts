import { Module, DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NotificationService } from './notification.service';

export interface NotificationModuleOptions {
  urls: string[];
  queue: string;
}

@Module({})
export class NotificationModule {
  static register(options: NotificationModuleOptions): DynamicModule {
    return {
      module: NotificationModule,
      imports: [
        ClientsModule.register([
          {
            name: 'NOTIFICATION_SERVICE',
            transport: Transport.RMQ,
            options: {
              urls: options.urls,
              queue: options.queue,
              queueOptions: { durable: true },
            },
          },
        ]),
      ],
      providers: [NotificationService],
      exports: [NotificationService],
    };
  }
}
