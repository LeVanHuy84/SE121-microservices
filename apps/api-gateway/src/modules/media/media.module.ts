import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.CONTENT_FEED_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('CONTENT_FEED_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class MediaModule {}
