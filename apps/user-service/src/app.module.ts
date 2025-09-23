import { Module } from "@nestjs/common";
import { DrizzleModule } from "./drizzle/drizzle.module";
import { UserModule } from "./module/user.module";
import { ConfigModule } from "@nestjs/config";
import { UserController } from "./module/user.controller";
import { ClientsModule, Transport } from "@nestjs/microservices";

@Module({
  imports: [
    DrizzleModule,
    UserModule,
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}
