import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';
import { KafkaAppModule } from './kafka-app.module';

async function bootstrap() {
  // ========== 1) MAIN APP (HTTP + TCP + REDIS) ==========
  const app = await NestFactory.create(AppModule);

  // TCP
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      port: parseInt(process.env.TCP_PORT || '4002'),
    },
  });

  // Redis (nếu cần)
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.REDIS,
    options: {
      port: 6379,
      host: 'localhost',
    },
  });

  app.useGlobalFilters(new ExceptionsFilter());

  // Start HTTP + all microservices (TCP, Redis)
  await app.startAllMicroservices();
  await app.listen(process.env.HTTP_PORT || 3000);

  // ========== 2) KAFKA APP RIÊNG ==========
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
    }
  );

  await kafkaApp.listen();
}

bootstrap();
