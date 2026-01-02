import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';

export const CLERK_CLIENT = Symbol('CLERK_CLIENT');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CLERK_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secretKey = config.get<string>('CLERK_SECRET_KEY');

        if (!secretKey) {
          throw new Error(
            'CLERK_SECRET_KEY is missing. Check env or turbo env config.'
          );
        }

        return createClerkClient({
          secretKey,
        });
      },
    },
  ],
  exports: [CLERK_CLIENT],
})
export class ClerkModule {}
