import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';

async function bootstrap() {
  const tcpApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4002,
      },
    }
  );

  const redisApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.REDIS,
      options: {
        port: 6379,
        host: 'localhost',
      },
    }
  );

  tcpApp.useGlobalFilters(new ExceptionsFilter());
  redisApp.useGlobalFilters(new ExceptionsFilter());

  await Promise.all([tcpApp.listen(), redisApp.listen()]);
}
bootstrap();
