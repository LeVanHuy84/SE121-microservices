// src/auth/auth.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { ClerkClientProvider } from 'src/providers/clerk-client.provider';
import { ClerkStrategy } from './clerk.strategy';

@Module({
    imports: [PassportModule, ConfigModule],
    providers: [ClerkStrategy, ClerkClientProvider],
    exports: [PassportModule],
})
export class AuthModule { }