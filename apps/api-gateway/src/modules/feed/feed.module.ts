import { Module } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.FEED_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('FEED_SERVICE_PORT'),
          },
        }),
      },
    ]),
  ],
  controllers: [FeedController],
  providers: [],
})
export class FeedModule {}
