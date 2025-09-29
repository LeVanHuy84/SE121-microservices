import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ImagesModule } from './images/images.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ImagesModule,
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}
