import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersController } from './users.controller';
import { MediaModule } from '../media/media.module';
import { ClerkClientProvider } from 'src/providers/clerk-client.provider';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.USER_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>('USER_SERVICE_PORT'),
          },
        }),
      },
    ]),
    MediaModule
  ],
  providers: [ClerkClientProvider],
  controllers: [UsersController],
  exports: [ClientsModule],
})
export class UserModule {}
