// src/common/modules/social-client.module.ts
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { SocialClientService } from './social-client.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'SOCIAL_SERVICE',
        transport: Transport.REDIS,
        options: {
          host: 'localhost',
          port: 6379,
        },
      },
    ]),
  ],
  providers: [SocialClientService],
  exports: [ClientsModule, SocialClientService],
})
export class SocialClientModule {}
