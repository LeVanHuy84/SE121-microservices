import { Module } from "@nestjs/common";
import { EmotionController } from "./emotion.controller";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MICROSERVICES_CLIENTS } from "src/common/constants";

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.EMOTION_INTELLIGENCE_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host:
              config.get<string>("EMOTION_INTELLIGENCE_SERVICE_HOST") ||
              "127.0.0.1",
            port: config.get<number>("EMOTION_INTELLIGENCE_SERVICE_PORT"),
          },
        }),
      },
    ]),
  ],
  controllers: [EmotionController],
  providers: [],
})
export class EmotionModule {}
