import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { Neo4jTypeInterceptor } from './neo4j/neo4j-type.interceptor';
import { Neo4jErrorFilter } from './neo4j/neo4j.filter';

async function bootstrap() {
  const tcpApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4002,
      },
    },
  );
  tcpApp.useGlobalPipes(new ValidationPipe());
  tcpApp.useGlobalInterceptors(new Neo4jTypeInterceptor());
  tcpApp.useGlobalFilters(new Neo4jErrorFilter());

  const redisApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.REDIS,
      options: {
        port: 6379,
        host: 'localhost',
      },
    },
  );
  await Promise.all([tcpApp.listen(), redisApp.listen()]);

  console.log('Social service is running on port 4002');
}
bootstrap();
