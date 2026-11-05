import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { ReactionService } from "./reaction.service";

import { DisReactDTO, GetReactionsDTO, ReactDTO } from "@repo/dtos";

@Controller("react")
export class ReactionController {
  constructor(private reactionService: ReactionService) {}

  @TcpMessagePattern("react")
  react(data: { userId: string; dto: ReactDTO }) {
    return this.reactionService.react(data.userId, data.dto);
  }

  @TcpMessagePattern("dis_react")
  disReact(data: { userId: string; dto: DisReactDTO }) {
    return this.reactionService.disReact(data.userId, data.dto);
  }

  @TcpMessagePattern("get_reactions")
  getReactions(dto: GetReactionsDTO) {
    return this.reactionService.getReactions(dto);
  }
}
