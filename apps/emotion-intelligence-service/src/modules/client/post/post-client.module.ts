import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'POST_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host:
              config.get<string>('CONTENT_FEED_SERVICE_HOST') || '127.0.0.1',
            port: config.get<number>('CONTENT_FEED_SERVICE_PORT') || 4002,
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class PostClientModule {}
