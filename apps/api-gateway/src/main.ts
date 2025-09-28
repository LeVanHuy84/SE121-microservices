import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createProxyMiddleware } from "http-proxy-middleware";
import { ValidationPipe } from '@nestjs/common';
import { GatewayExceptionsFilter } from './common/filters/gateway.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();


  app.useGlobalFilters(new GatewayExceptionsFilter());
  // set global prefix
  app.setGlobalPrefix('api/v1');

  await app.listen(process.env.GATEWAY_PORT ?? 4000);
}
bootstrap();
