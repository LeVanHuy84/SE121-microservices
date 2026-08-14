import { Module } from "@nestjs/common";
import { ReactionController } from "./reaction.controller";
import { ReactionService } from "./reaction.service";
import { Reaction } from "src/entities/reaction.entity";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserSocialClientModule } from "../client/user-social-client.module";
import { StatsModule } from "../stats/stats.module";
import { EventModule } from "../event/event.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Reaction]),
    UserSocialClientModule,
    StatsModule,
    EventModule,
  ],
  controllers: [ReactionController],
  providers: [ReactionService],
  exports: [ReactionService],
})
export class ReactionModule {}
