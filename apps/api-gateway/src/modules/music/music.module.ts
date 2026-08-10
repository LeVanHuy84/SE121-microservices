import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MusicController } from './music.controller';
import { MusicAnalyzeService } from './music-analyze.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.MUSIC_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('SEARCH_RECOMMENDATION_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [MusicController],
  providers: [MusicAnalyzeService],
})
export class MusicModule {}
