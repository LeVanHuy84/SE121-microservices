// src/auth/clerk.strategy.ts
import { verifyToken } from '@clerk/backend';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { Request } from 'express';
import type { ClerkClient } from '@clerk/backend';

@Injectable()
export class ClerkStrategy extends PassportStrategy(Strategy, 'clerk') {
  constructor(
    @Inject('ClerkClient')
    private readonly clerkClient: ClerkClient,
    private readonly configService: ConfigService
  ) {
    super();
  }

  async validate(req: Request) {
    const token = req.headers.authorization?.split(' ').pop();
    if (!token) throw new UnauthorizedException('No token provided');

    try {
      const tokenPayload = await verifyToken(token, {
        secretKey: this.configService.get('CLERK_SECRET_KEY'),
      });

      // gắn externalId để dùng ngay
      return {
        sub: tokenPayload.sub,
        userId: tokenPayload.userId ?? null,
        raw: tokenPayload,
      };
    } catch (error) {
      console.error(error);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
