import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserClientService } from './user-client.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'USER_SERVICE',
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>('USER_SOCIAL_SERVICE_HOST', 'localhost'),
            port: config.get<number>('USER_SOCIAL_SERVICE_PORT', 4001),
          },
        }),
      },
    ]),
  ],
  providers: [UserClientService],
  exports: [UserClientService],
})
export class UserClientModule {}
