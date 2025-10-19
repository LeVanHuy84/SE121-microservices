import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';

async function bootstrap() {
  const tcp_app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4007,
      },
    }
  );
  const rabbitmq_app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: ['amqp://guest:guest@localhost:5672'], // hoặc 'amqp://rabbitmq:5672' nếu docker
        queue: 'create_notification_queue',
        queueOptions: {
          durable: true,
        },
        noAck: false,
      },
    }
  );
  tcp_app.useGlobalFilters(new ExceptionsFilter());
  rabbitmq_app.useGlobalFilters(new ExceptionsFilter());

  await Promise.all([tcp_app.listen(), rabbitmq_app.listen()]);
  console.log('Notification service is listening...');
}
bootstrap();
