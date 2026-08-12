import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { UserClientService } from './user-client.service';
import { MICROSERVICES_CLIENT } from 'src/constant';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENT.USER_SOCIAL_SERVICE,
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
  exports: [ClientsModule, UserClientService],
})
export class UserSocialClientModule {}
