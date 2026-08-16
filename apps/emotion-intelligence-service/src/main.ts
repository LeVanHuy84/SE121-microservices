import { initOTel } from '@repo/common';
initOTel('emotion-intelligence-service');

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';
import { AppModule } from './app.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';

async function bootstrap() {
  const tcpApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4013,
      },
    },
  );

  const kafkaApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    IngestionModule,
    {
      transport: Transport.KAFKA,
      options: {
        client: {
          brokers: process.env.KAFKA_BROKERS!.split(','),
          clientId: process.env.KAFKA_CLIENT_ID!,
        },
        consumer: {
          groupId: process.env.KAFKA_GROUP_ID!,
        },
      },
    },
  );

  tcpApp.useGlobalFilters(new ExceptionsFilter());
  kafkaApp.useGlobalFilters(new ExceptionsFilter());

  await Promise.all([tcpApp.listen(), kafkaApp.listen()]);
}
void bootstrap();
