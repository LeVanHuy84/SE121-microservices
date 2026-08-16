import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { HttpModule } from "@nestjs/axios";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { Agent as HttpAgent } from "http";
import { Agent as HttpsAgent } from "https";
import { MICROSERVICES_CLIENTS } from "src/common/constants";
import { ChatbotController } from "./chatbot.controller";

import { AssistantContextService } from "./assistant-context.service";
import { ChatbotService } from "./chatbot.service";

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const keepAliveRaw = config.get<string | boolean>(
          "CHATBOT_HTTP_KEEP_ALIVE",
          "true",
        );
        const keepAlive =
          typeof keepAliveRaw === "boolean"
            ? keepAliveRaw
            : String(keepAliveRaw).toLowerCase() === "true";
        const keepAliveMsecs = Number(
          config.get<string | number>("CHATBOT_HTTP_KEEP_ALIVE_MSECS", 1000),
        );
        const maxSockets = Number(
          config.get<string | number>("CHATBOT_HTTP_MAX_SOCKETS", 100),
        );
        const maxFreeSockets = Number(
          config.get<string | number>("CHATBOT_HTTP_MAX_FREE_SOCKETS", 20),
        );
        const timeout = Number(
          config.get<string | number>("CHATBOT_SERVICE_TIMEOUT_MS", 12000),
        );

        return {
          timeout,
          maxRedirects: 0,
          httpAgent: new HttpAgent({
            keepAlive,
            keepAliveMsecs,
            maxSockets,
            maxFreeSockets,
          }),
          httpsAgent: new HttpsAgent({
            keepAlive,
            keepAliveMsecs,
            maxSockets,
            maxFreeSockets,
          }),
        };
      },
    }),
    ClientsModule.registerAsync([
      {
        name: MICROSERVICES_CLIENTS.SEARCH_RECOMMENDATION_SERVICE,
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host:
              config.get<string>("SEARCH_RECOMMENDATION_SERVICE_HOST") ||
              "127.0.0.1",
            port: config.get<number>("SEARCH_RECOMMENDATION_SERVICE_PORT"),
          },
        }),
      },
    ]),
  ],
  controllers: [ChatbotController],
  providers: [ChatbotService, AssistantContextService],
})
export class ChatbotModule {}
