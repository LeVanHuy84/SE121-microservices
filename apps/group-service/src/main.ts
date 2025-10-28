import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      port: process.env.PORT ? parseInt(process.env.PORT) : 4008,
    },
  });

  app.useGlobalFilters(new ExceptionsFilter());

  await app.startAllMicroservices();
  await app.init();
}
bootstrap();
