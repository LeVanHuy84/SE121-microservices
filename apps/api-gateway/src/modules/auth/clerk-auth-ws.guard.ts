// src/auth/clerk-ws.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { WsException } from '@nestjs/websockets';
import { verifyToken } from '@clerk/backend';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClerkWsGuard implements CanActivate {
  private readonly logger = new Logger(ClerkWsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const client = context.switchToWs().getClient();
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers['authorization']?.replace('Bearer ', '');

    if (!token) throw new WsException('Unauthorized: Missing token');

    try {
      const payload = await verifyToken(token, {
        secretKey: this.configService.get('CLERK_SECRET_KEY'),
      });

      client.data.user = {
        sub: payload.sub,
        userId: payload.userId ?? null,
      };

      this.logger.log(`✅ Authenticated WS user ${payload.sub}`);
      return true;
    } catch (error) {
      this.logger.warn(`❌ Invalid Clerk token: ${error.message}`);
      throw new WsException('Unauthorized: Invalid Clerk token');
    }
  }
}
