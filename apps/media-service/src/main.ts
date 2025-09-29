import { NestFactory } from '@nestjs/core';
import { ExceptionsFilter } from '@repo/common';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4004,
      },
    }
  );
  app.useGlobalFilters(new ExceptionsFilter());
  await app.listen();
}
bootstrap();
