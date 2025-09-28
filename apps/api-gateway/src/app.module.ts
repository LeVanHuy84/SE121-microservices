import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MICROSERVICES_CLIENTS } from './common/constants';
import { ClerkClientProvider } from './providers/clerk-client.provider';
import { AuthModule } from './modules/auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { ClerkAuthGuard } from './modules/auth/clerk-auth.guard';
import { UsersController } from './modules/users/users.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // để không cần import ở các module khác
    }),
    AuthModule,

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

  providers: [
    ClerkClientProvider,
    {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    },
  ],

  controllers: [UsersController],
})
export class AppModule { }
