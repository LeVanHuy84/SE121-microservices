import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GatewayExceptionsFilter } from './common/filters/gateway.filter';
import { DateFormatInterceptor } from './common/interceptors/date-format.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  app.useGlobalFilters(new GatewayExceptionsFilter());
  app.useGlobalInterceptors(new DateFormatInterceptor());
  // set global prefix
  app.setGlobalPrefix('api/v1');

  await app.listen(process.env.GATEWAY_PORT ?? 4000);
}
bootstrap();
