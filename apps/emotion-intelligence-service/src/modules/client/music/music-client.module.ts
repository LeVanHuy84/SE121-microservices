import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MusicClientService } from './music-client.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'SEARCH_RECOMMENDATION_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host:
              config.get<string>('SEARCH_RECOMMENDATION_SERVICE_HOST') ||
              '127.0.0.1',
            port: config.get<number>(
              'SEARCH_RECOMMENDATION_SERVICE_PORT',
              4003,
            ),
          },
        }),
      },
    ]),
  ],
  providers: [MusicClientService],
  exports: [MusicClientService],
})
export class MusicClientModule {}
