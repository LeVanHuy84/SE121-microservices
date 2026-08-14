import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { NotificationController } from "./notification.controller";

@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.CONTENT_FEED_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>("CONTENT_FEED_SERVICE_PORT"),
          },
        }),
      },
    ]),
  ],
  controllers: [NotificationController],
  providers: [],
  exports: [ClientsModule],
})
export class NotificationModule {}
