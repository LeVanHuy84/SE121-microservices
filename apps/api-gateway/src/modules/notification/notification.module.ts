import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { RabbitmqModule } from '@repo/common';

@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.NOTIFICATION_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('NOTIFICATION_SERVICE_PORT'),
          },
        }),
      },
    ]),
   
  ],
  controllers: [NotificationController],
  providers: [NotificationGateway],
})
export class NotificationModule {}
