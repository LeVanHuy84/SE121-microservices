import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CreatePostDto } from '@repo/dtos';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  await app.listen(process.env.GATEWAY_PORT ?? 4000);
}
bootstrap();
