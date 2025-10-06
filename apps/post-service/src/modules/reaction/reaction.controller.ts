import { Controller } from '@nestjs/common';
import { ReactionService } from './reaction.service';
import { EventPattern, MessagePattern } from '@nestjs/microservices';
import { DisReactDTO, GetReactionsDTO, ReactDTO } from '@repo/dtos';

@Controller('react')
export class ReactionController {
  constructor(private reactionService: ReactionService) {}

  @EventPattern('react')
  react(data: { userId: string; dto: ReactDTO }) {
    this.reactionService.react(data.userId, data.dto);
  }

  @EventPattern('dis_react')
  disReact(data: { userId: string; dto: DisReactDTO }) {
    this.reactionService.disReact(data.userId, data.dto);
  }

  @MessagePattern('get_reactions')
  getReactions(dto: GetReactionsDTO) {
    return this.reactionService.getReactions(dto);
  }
}
