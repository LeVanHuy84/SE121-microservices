import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.MEDIA_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('MEDIA_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [MediaController],
})
export class MediaModule {}
