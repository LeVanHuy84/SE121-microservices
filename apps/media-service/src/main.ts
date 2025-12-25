import { NestFactory } from '@nestjs/core';
import { ExceptionsFilter } from '@repo/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ExceptionsFilter());

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT, 10) : 4004,
      },
    },
    { inheritAppConfig: true }
  );

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.KAFKA,
      options: {
        client: {
          brokers: process.env.KAFKA_BROKERS!.split(','),
          clientId: process.env.KAFKA_CLIENT_ID!,
        },
        consumer: {
          groupId: process.env.KAFKA_MEDIA_ID!,
        },
      },
    },
    { inheritAppConfig: true }
  );

  const httpPort = process.env.HTTP_PORT
    ? parseInt(process.env.HTTP_PORT, 10)
    : 4200;

  await app.startAllMicroservices();
  await app.listen(httpPort);
}
bootstrap();
