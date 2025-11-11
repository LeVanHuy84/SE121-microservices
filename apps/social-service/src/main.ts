import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';
import { AppModule } from './app.module';
import { Neo4jTypeInterceptor } from './neo4j/neo4j-type.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.TCP,
    options: {
      port: process.env.PORT ? parseInt(process.env.PORT) : 4006,
    },
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.REDIS,
    options: {
      port: 6379,
      host: 'localhost',
    },
  });
  app.useGlobalFilters(new ExceptionsFilter());

  await app.startAllMicroservices();
  await app.init();

  console.log('Social service is running on port 4006');
}
bootstrap();
