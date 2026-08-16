import { initOTel } from '@repo/common';
initOTel('chat-service');

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    transport: Transport.TCP,
    options: {
      host: '0.0.0.0',
      port: process.env.PORT ? parseInt(process.env.PORT) : 4004,
    },
  });

  app.useGlobalFilters(new ExceptionsFilter());
  await app.listen();
}
void bootstrap();
