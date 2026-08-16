import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EmotionFeatureService } from "./services/emotion-feature.service";
import { AffinityModule } from "../affinity/affinity.module";
import { ScoreCombinerService } from "./services/score-combiner.service";
import { ClientsModule, Transport } from "@nestjs/microservices";

/**
 * RankingModule - Module quản lý ranking logic
 *
 * Exports:
 * - RankingService: orchestrator cho trending & personal ranking
 * - UserAffinityService: quản lý user emotion affinity
 * - EmotionFeatureService: fetch emotion features từ analysis-service
 */
@Module({
  imports: [
    ConfigModule,
    AffinityModule,
    ClientsModule.registerAsync([
      {
        name: "EMOTION_INTELLIGENCE_SERVICE",
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
  providers: [
    // Services
    EmotionFeatureService,
    ScoreCombinerService,
  ],
  exports: [EmotionFeatureService, ScoreCombinerService],
})
export class RankingModule {}
