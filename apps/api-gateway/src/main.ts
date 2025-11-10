import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GatewayExceptionsFilter } from './common/filters/gateway.filter';
import { RedisIoAdapter } from './redis.adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();

  app.useGlobalFilters(new GatewayExceptionsFilter());
  // set global prefix
  app.setGlobalPrefix('api/v1');

  await app.listen(process.env.GATEWAY_PORT ?? 4000);
}
bootstrap();
