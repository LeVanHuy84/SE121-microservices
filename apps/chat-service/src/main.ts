import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    transport: Transport.TCP,
    options: {
      port: process.env.PORT ? parseInt(process.env.PORT) : 4008,
    },
  });
  await app.listen();
}
void bootstrap();
