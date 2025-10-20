import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';
import { TCPAppModule } from './tcp-app.module';
import { KafkaAppModule } from './kafka-app.module';

async function bootstrap() {
  const tcpApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    TCPAppModule,
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4007,
      },
    },
  );

  const kafkaApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    KafkaAppModule,
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
bootstrap();
