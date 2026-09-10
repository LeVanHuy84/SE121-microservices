import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { NotificationController } from "./notification.controller";
import { NotificationGateway } from "./notification.gateway";

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
            host:
              config.get<string>("CONTENT_FEED_SERVICE_HOST") || "127.0.0.1",
            port: config.get<number>("CONTENT_FEED_SERVICE_PORT"),
          },
        }),
      },
    ]),
  ],
  controllers: [NotificationController],
  providers: [NotificationGateway],
  exports: [ClientsModule, NotificationGateway],
})
export class NotificationModule {}
