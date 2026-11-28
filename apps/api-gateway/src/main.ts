import { initOTel, StructuredLoggerService } from "@repo/common";
initOTel("api-gateway", { collectDefaultMetrics: false });

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { GatewayExceptionsFilter } from "./common/filters/gateway.filter";
import { DateFormatInterceptor } from "./common/interceptors/date-format.interceptor";
import { RedisIoAdapter } from "./redis.adapter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: new StructuredLoggerService("api-gateway"),
  });
  app.enableShutdownHooks();
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();

  const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : true;
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalFilters(new GatewayExceptionsFilter());
  // Performance optimization: DateFormatInterceptor causes recursive double-serialization and high CPU.
  // Standard RESTful APIs return ISO-8601 UTC directly; clients format locally.
  if (process.env.ENABLE_DATE_FORMAT_INTERCEPTOR === "true") {
    app.useGlobalInterceptors(new DateFormatInterceptor());
  }
  // set global prefix
  app.setGlobalPrefix("api/v1");

  app.useWebSocketAdapter(redisIoAdapter);
  await app.listen(process.env.GATEWAY_PORT ?? 4000);
}
bootstrap();
