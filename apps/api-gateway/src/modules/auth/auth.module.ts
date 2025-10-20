// src/auth/auth.module.ts

import { Module } from '@nestjs/common';
import { ClerkStrategy } from './clerk.strategy';
import { PassportModule } from '@nestjs/passport';
import { ClerkClientProvider } from 'src/providers/clerk-client.provider';
import { ConfigModule } from '@nestjs/config';
import { ClerkWsGuard } from './clerk-auth-ws.guard';

@Module({
    imports: [PassportModule, ConfigModule],
    providers: [ClerkStrategy, ClerkClientProvider, ClerkWsGuard],
    exports: [PassportModule],
})
export class AuthModule { }