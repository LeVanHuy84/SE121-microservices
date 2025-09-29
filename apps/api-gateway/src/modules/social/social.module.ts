import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.SOCIAL_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('SOCIAL_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [SocialController],
})
export class SocialModule {}
