import { Module } from "@nestjs/common";
import { DrizzleModule } from "./drizzle/drizzle.module";
import { UserModule } from "./module/user.module";
import { ConfigModule } from "@nestjs/config";
import { UserController } from "./module/user.controller";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { RedisModule } from '@nestjs-modules/ioredis';
@Module({
  imports: [
    DrizzleModule,
    UserModule,
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule.forRoot({
      type: 'single',
      options: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
          ? parseInt(process.env.REDIS_PORT, 10)
          : 6379,
      },
    }),
  ],
})
export class AppModule {}

