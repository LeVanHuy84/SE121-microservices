import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GroupClientService } from './group-client.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'GROUP_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>('GROUP_SERVICE_HOST') || 'localhost',
            port: config.get<number>('GROUP_SERVICE_PORT', 4008),
          },
        }),
      },
    ]),
  ],
  providers: [GroupClientService],
  exports: [GroupClientService],
})
export class GroupClientModule {}
