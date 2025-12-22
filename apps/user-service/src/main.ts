import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ExceptionsFilter } from '@repo/common';
import { CommandService } from './module/command/command.service';

async function bootstrap() {
  const tcpApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.TCP,
      options: {
        port: process.env.PORT ? parseInt(process.env.PORT) : 4001,
      },
    }
  );
  tcpApp.useGlobalFilters(new ExceptionsFilter());

  const redisApp = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.REDIS,
      options: {
        port: 6379,
        host: 'localhost',
      },
    }
  );

  await Promise.all([tcpApp.listen(), redisApp.listen()]);

  const commandApp = await NestFactory.createApplicationContext(AppModule);
  const commandService = commandApp.get(CommandService);
  await commandService.run();
  await commandApp.close();

  console.log('User service is running on port 6379');
}
bootstrap();
