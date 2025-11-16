import { Module, DynamicModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { NotificationService } from './notification.service';

export interface NotificationModuleOptions {
  urls: string[];
  queue: string;
}

export interface NotificationModuleAsyncOptions {
  useFactory: (
    ...args: any[]
  ) => Promise<NotificationModuleOptions> | NotificationModuleOptions;
  inject?: any[];
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

  static registerAsync(options: NotificationModuleAsyncOptions): DynamicModule {
    return {
      module: NotificationModule,
      imports: [
        ClientsModule.registerAsync([
          {
            name: 'NOTIFICATION_SERVICE',
            useFactory: async (...args) => {
              const opts = await options.useFactory(...args);
              return {
                transport: Transport.RMQ,
                options: {
                  urls: opts.urls,
                  queue: opts.queue,
                  queueOptions: { durable: true },
                },
              };
            },
            inject: options.inject || [],
          },
        ]),
      ],
      providers: [NotificationService],
      exports: [NotificationService],
    };
  }
}
