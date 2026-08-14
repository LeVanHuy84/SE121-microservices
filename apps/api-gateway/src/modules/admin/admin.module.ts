import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminEmotionController } from "./admin-emotion.controller";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ModerationController } from "./moderation.controller";

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
      {
        name: MICROSERVICES_CLIENTS.USER_SOCIAL_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>("USER_SOCIAL_SERVICE_PORT"),
          },
        }),
      },
      {
        name: MICROSERVICES_CLIENTS.EMOTION_INTELLIGENCE_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            port: config.get<number>("EMOTION_INTELLIGENCE_SERVICE_PORT"),
          },
        }),
      },
    ]),
  ],
  controllers: [AdminController, ModerationController, AdminEmotionController],
})
export class AdminModule {}
