// src/auth/auth.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { ClerkClientProvider } from 'src/providers/clerk-client.provider';
import { ClerkStrategy } from './clerk.strategy';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkWebhookService } from './clerk-webhook.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
    imports: [PassportModule, ConfigModule, NotificationModule],
    controllers: [ClerkWebhookController],
    providers: [ClerkStrategy, ClerkClientProvider, ClerkWebhookService],
    exports: [PassportModule],
})
export class AuthModule { }