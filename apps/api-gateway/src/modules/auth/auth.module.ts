// src/auth/auth.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PassportModule } from '@nestjs/passport';
import { MICROSERVICES_CLIENTS } from 'src/common/constants';
import { ClerkClientProvider } from 'src/providers/clerk-client.provider';
import { ClerkStrategy } from './clerk.strategy';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkWebhookService } from './clerk-webhook.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
    imports: [
        PassportModule,
        ConfigModule,
        NotificationModule,
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
    ],
    controllers: [ClerkWebhookController],
    providers: [ClerkStrategy, ClerkClientProvider, ClerkWebhookService],
    exports: [PassportModule],
})
export class AuthModule { }