import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { ExceptionsFilter } from '@repo/common';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        host: process.env.MUSIC_SERVICE_HOST || 'localhost',
        port: parseInt(process.env.MUSIC_SERVICE_PORT || '4014', 10),
      },
    },
  );

  app.useGlobalFilters(new ExceptionsFilter());

  await app.listen();
}
bootstrap();
